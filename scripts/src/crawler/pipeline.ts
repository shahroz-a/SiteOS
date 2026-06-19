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
  reclassifyMalformedQueueItems,
  type QueueStats,
} from "./queue";
import { fetchPage } from "./fetcher";
import { assemblePage } from "./assemble";
import { validateExtraction } from "./validate";
import { logCrawl, storePage, storeValidation } from "./store";
import { closeBrowser, isBrowserAvailable } from "./browser";
import { generateReports } from "./reports";
import {
  collapseSlashes,
  isAssetUrl,
  isBlogUrl,
  isFrontierDiscovered,
  isMalformedBlogUrl,
  sleep,
} from "./util";
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
export async function processItem(
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

    // Non-HTML resources (images, PDFs, …) reached via frontier links must
    // never be parsed/stored as pages — their bytes contain NULs Postgres
    // rejects. Skip them cleanly instead of failing.
    if (fetchResult.nonHtml) {
      await logCrawl({
        url: item.url,
        level: "info",
        httpStatus: fetchResult.httpStatus,
        message: "skipped non-HTML resource",
        durationMs: Date.now() - started,
      });
      return { status: "skipped" };
    }

    // A blog URL that redirects to a non-blog destination has moved off the blog
    // (e.g. a retired web story 301'd to a product page, or an old post pointing
    // at a `/…-tickets/` listing). Don't parse/store the off-blog page or retry
    // it to exhaustion — skip it by design so it stops burning fetch attempts.
    if (
      fetchResult.redirectChain.length > 0 &&
      isBlogUrl(item.url) &&
      !isBlogUrl(fetchResult.finalUrl)
    ) {
      await logCrawl({
        url: item.url,
        level: "info",
        httpStatus: fetchResult.httpStatus,
        message: `skipped: redirected off-blog to ${fetchResult.finalUrl}`,
        details: { redirectChain: fetchResult.redirectChain },
        durationMs: Date.now() - started,
      });
      return { status: "skipped" };
    }

    // Non-2xx with no body: treat as a failure to retry/record. A frontier-
    // discovered link that is simply gone (404/410) is a dead internal link in
    // the source content — expected cruft, not a migration blocker — so skip it
    // (one attempt) rather than retrying to exhaustion and inflating the failed
    // count. Sitemap-declared URLs and transient errors (5xx) still fail loudly.
    if (fetchResult.httpStatus >= 400 || (!fetchResult.html && fetchResult.httpStatus !== 200)) {
      const deadLink =
        (fetchResult.httpStatus === 404 || fetchResult.httpStatus === 410) &&
        isFrontierDiscovered(item.discoveredFrom);
      await logCrawl({
        url: item.url,
        level: deadLink ? "info" : "warn",
        httpStatus: fetchResult.httpStatus,
        message: deadLink
          ? `skipped: dead link (${fetchResult.httpStatus})`
          : `non-OK response (${fetchResult.httpStatus})`,
        durationMs: Date.now() - started,
      });
      return { status: deadLink ? "skipped" : "failed" };
    }

    // Only genuine sitemap-declared items carry a sitemap source. A frontier
    // `discoveredFrom` is a discovering *page* URL, not a sitemap, so don't
    // mislabel it as `sitemapSource`.
    const sitemapMeta =
      item.discoveredFrom && !isFrontierDiscovered(item.discoveredFrom)
        ? { sitemapSource: item.discoveredFrom, lastmod: null }
        : null;
    const page = assemblePage(fetchResult, sitemapMeta, config);

    const validation = validateExtraction(page);
    if (validation.status === "fail" && attempt < maxExtractionRetries) {
      log(`  validation failed for ${item.url} (attempt ${attempt}), retrying extraction…`);
      await sleep(config.perRequestDelayMs);
      continue;
    }

    // A failing validation holds the page back: storePage records it as "draft"
    // so it stays out of the public read API until an editor reviews it.
    const stored = await storePage(page, { validationStatus: validation.status });
    await storeValidation(stored.pageId, validation);
    const heldBack = validation.status === "fail";
    await logCrawl({
      url: item.url,
      pageId: stored.pageId,
      level: validation.status === "fail" ? "error" : "info",
      httpStatus: fetchResult.httpStatus,
      message: `${stored.created ? "created" : stored.changed ? "updated" : "unchanged"} (v${stored.versionNumber}, ${page.via}); validation=${validation.status}${heldBack ? " (held back for review)" : ""}`,
      details: { counts: page.counts, redirectChain: page.redirectChain },
      durationMs: Date.now() - started,
    });

    // Frontier expansion: enqueue internal blog links discovered on the page.
    // Normalize (collapse accidental `//`) and drop structurally malformed hrefs
    // (concatenated/bare-domain links) so the queue's failed count reflects real
    // fetch problems, not garbage source markup that can never resolve.
    for (const link of page.internalLinks) {
      const href = collapseSlashes(link.href);
      if (isBlogUrl(href) && !isAssetUrl(href) && !isMalformedBlogUrl(href)) {
        await enqueueOne(href, item.url, 10);
      }
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

  const recovered = await recoverStaleInProgress(config.maxAttempts);
  if (recovered > 0) log(`Recovered ${recovered} stale in-progress items.`);

  const reclassified = await reclassifyMalformedQueueItems();
  if (reclassified > 0)
    log(`Reclassified ${reclassified} malformed/asset URLs as skipped (queue hygiene).`);

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
          // Never let bookkeeping errors (e.g. a transient pooler drop while
          // recording the failure) escape and abort the whole crawl run. The
          // item is left for recovery/retry on a later pass or restart.
          try {
            await markFailed(item.id, message, config.maxAttempts);
            await logCrawl({ url: item.url, level: "error", message });
          } catch (bookkeepingErr) {
            const m = bookkeepingErr instanceof Error ? bookkeepingErr.message : String(bookkeepingErr);
            log(`  failed to record failure for ${item.url}: ${m}`);
          }
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
