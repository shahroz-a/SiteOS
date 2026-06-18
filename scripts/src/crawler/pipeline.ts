import { DEFAULT_CONFIG, type CrawlerConfig } from "./config";
import { discoverFromSitemaps } from "./sitemap";
import {
  claimBatch,
  enqueueOne,
  enqueueUrls,
  hasPendingWork,
  markCompleted,
  markFailed,
  markSkipped,
  queueStats,
  recoverStaleInProgress,
  type QueueStats,
} from "./queue";
import { fetchPage } from "./fetcher";
import { assemblePage } from "./assemble";
import { validateExtraction } from "./validate";
import { logCrawl, storePage, storeValidation } from "./store";
import { closeBrowser, isBrowserAvailable } from "./browser";
import { generateReports } from "./reports";
import { isBlogUrl, sleep } from "./util";
import type { CrawlQueueItem } from "@workspace/db";

export interface DiscoverResult {
  discovered: number;
  enqueued: number;
}

/** Step 1+2: discover URLs from all sitemaps and idempotently enqueue them. */
export async function runDiscovery(log: (m: string) => void = console.log): Promise<DiscoverResult> {
  log("Discovering URLs from sitemaps…");
  const urls = await discoverFromSitemaps(undefined, log);
  log(`Discovered ${urls.length} unique URLs. Enqueuing…`);
  const enqueued = await enqueueUrls(urls);
  log(`Enqueued ${enqueued} new URLs (existing ones preserved).`);
  return { discovered: urls.length, enqueued };
}

interface ProcessOutcome {
  status: "completed" | "failed" | "skipped";
  pageId?: string;
  changed?: boolean;
  validation?: ReturnType<typeof validateExtraction>;
}

/**
 * Steps 3–7 for a single queue item: fetch/render, extract, normalize,
 * validate (retry once on failure), and store. Newly-discovered internal blog
 * links are enqueued so the crawl reaches pages not present in the sitemaps.
 */
async function processItem(
  item: CrawlQueueItem,
  config: CrawlerConfig,
  log: (m: string) => void,
): Promise<ProcessOutcome> {
  const started = Date.now();
  let attempt = 0;
  const maxExtractionRetries = 2;

  while (attempt < maxExtractionRetries) {
    attempt += 1;
    const fetchResult = await fetchPage(item.url, config);

    // Non-2xx with no body: treat as a failure to retry/record.
    if (fetchResult.httpStatus >= 400 || (!fetchResult.html && fetchResult.httpStatus !== 200)) {
      await logCrawl({
        url: item.url,
        level: "warn",
        httpStatus: fetchResult.httpStatus,
        message: `non-OK response (${fetchResult.httpStatus})`,
        durationMs: Date.now() - started,
      });
      return { status: "failed" };
    }

    const page = assemblePage(
      fetchResult,
      item.discoveredFrom ? { sitemapSource: item.discoveredFrom, lastmod: null } : null,
      config,
    );

    const validation = validateExtraction(page);
    if (validation.status === "fail" && attempt < maxExtractionRetries) {
      log(`  validation failed for ${item.url} (attempt ${attempt}), retrying extraction…`);
      await sleep(config.perRequestDelayMs);
      continue;
    }

    const stored = await storePage(page);
    await storeValidation(stored.pageId, validation);
    await logCrawl({
      url: item.url,
      pageId: stored.pageId,
      level: validation.status === "fail" ? "error" : "info",
      httpStatus: fetchResult.httpStatus,
      message: `${stored.created ? "created" : stored.changed ? "updated" : "unchanged"} (v${stored.versionNumber}, ${page.via}); validation=${validation.status}`,
      details: { counts: page.counts, redirectChain: page.redirectChain },
      durationMs: Date.now() - started,
    });

    // Frontier expansion: enqueue internal blog links discovered on the page.
    for (const link of page.internalLinks) {
      if (isBlogUrl(link.href)) await enqueueOne(link.href, item.url, 10);
    }

    return { status: "completed", pageId: stored.pageId, changed: stored.changed, validation };
  }

  return { status: "failed" };
}

export interface CrawlRunOptions {
  /** Stop after processing at most this many items (0 = unlimited). */
  limit?: number;
  config?: Partial<CrawlerConfig>;
  log?: (m: string) => void;
}

/**
 * Step 1–8 driver: recover stale work, then run concurrent workers that drain
 * the queue until empty (or the limit is hit), persisting progress after every
 * page so the run is fully resumable and crash-safe.
 */
export async function runCrawl(opts: CrawlRunOptions = {}): Promise<QueueStats> {
  const config: CrawlerConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const log = opts.log ?? console.log;
  const limit = opts.limit ?? 0;

  const recovered = await recoverStaleInProgress();
  if (recovered > 0) log(`Recovered ${recovered} stale in-progress items.`);

  const browser = await isBrowserAvailable();
  log(`Rendering mode: ${browser ? "Playwright (browser)" : "HTTP fallback (no browser)"}.`);
  if (!browser) config.useBrowser = false;

  let processed = 0;
  let stop = false;

  const worker = async (id: number): Promise<void> => {
    while (!stop) {
      const remaining = limit > 0 ? limit - processed : config.concurrency;
      if (remaining <= 0) break;
      const batchSize = Math.min(config.concurrency, remaining);
      const batch = await claimBatch(batchSize, config.maxAttempts);
      if (batch.length === 0) {
        if (!(await hasPendingWork(config.maxAttempts))) break;
        await sleep(250);
        continue;
      }
      for (const item of batch) {
        if (stop || (limit > 0 && processed >= limit)) break;
        try {
          const outcome = await processItem(item, config, log);
          if (outcome.status === "completed") await markCompleted(item.id);
          else if (outcome.status === "skipped") await markSkipped(item.id, "skipped");
          else await markFailed(item.id, "processing failed", config.maxAttempts);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markFailed(item.id, message, config.maxAttempts);
          await logCrawl({ url: item.url, level: "error", message });
        }
        processed += 1;
        if (limit > 0 && processed >= limit) stop = true;
        if (processed % 10 === 0) log(`Processed ${processed} pages…`);
        await sleep(config.perRequestDelayMs);
      }
    }
    void id;
  };

  const workers = Array.from({ length: config.concurrency }, (_, i) => worker(i));
  await Promise.all(workers);
  await closeBrowser();

  const stats = await queueStats();
  log(`Crawl run complete. Processed ${processed} pages this run.`);
  log(
    `Queue: pending=${stats.pending} completed=${stats.completed} failed=${stats.failed} skipped=${stats.skipped}`,
  );
  return stats;
}

export async function runReports(log: (m: string) => void = console.log): Promise<string[]> {
  const stats = await queueStats();
  log("Generating migration deliverable reports…");
  const files = await generateReports(stats);
  for (const f of files) log(`  wrote ${f}`);
  return files;
}
