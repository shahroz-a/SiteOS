import { pool } from "@workspace/db";
import { fetchHtml } from "./import/fetch";
import { parsePage, discoverBlogLinks } from "./import/parse";
import { persistPage, resolveInternalLinks } from "./import/persist";
import {
  enqueueDiscovered,
  logCrawl,
  markCrawlResult,
  markQueued,
  recordValidation,
} from "./import/crawl";
import { DEFAULT_SOURCE_URLS, SITE_ORIGIN } from "./import/sources";
import type { PageReport } from "./import/types";
import { canonicalizeUrl } from "./import/util";

interface CliOptions {
  urls: string[];
  discover: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const urls: string[] = [];
  let discover = false;
  for (const arg of argv) {
    if (arg === "--discover") discover = true;
    else if (arg.startsWith("http")) urls.push(arg);
  }
  return { urls: urls.length ? urls : DEFAULT_SOURCE_URLS, discover };
}

interface ImportOutcome {
  report: PageReport;
  discoveredLinks: string[];
}

async function importOne(url: string): Promise<ImportOutcome> {
  const canonical = canonicalizeUrl(url) ?? url;
  await markQueued(canonical);
  try {
    const fetched = await fetchHtml(url);
    await logCrawl({
      url: canonical,
      level: fetched.httpStatus === 200 ? "info" : "warn",
      httpStatus: fetched.httpStatus,
      message: `Fetched ${fetched.html.length} bytes`,
      durationMs: fetched.durationMs,
    });
    if (fetched.httpStatus !== 200) {
      await markCrawlResult(canonical, "failed", `HTTP ${fetched.httpStatus}`);
      return {
        report: {
          url,
          ok: false,
          httpStatus: fetched.httpStatus,
          error: `HTTP ${fetched.httpStatus}`,
        },
        discoveredLinks: [],
      };
    }

    const page = parsePage(fetched);
    const result = await persistPage(page);
    const issues = await recordValidation(result.pageId, page, fetched);
    await logCrawl({
      url: canonical,
      pageId: result.pageId,
      level: issues.length ? "warn" : "info",
      httpStatus: 200,
      message: result.changed
        ? "Imported (content changed)"
        : "Imported (unchanged)",
      details: { counts: result.counts, issues },
    });
    await markCrawlResult(canonical, "completed");
    return {
      report: {
        url,
        ok: true,
        pageId: result.pageId,
        title: page.title,
        httpStatus: 200,
        changed: result.changed,
        counts: result.counts,
      },
      discoveredLinks: discoverBlogLinks(page, SITE_ORIGIN),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCrawlResult(canonical, "failed", message);
    await logCrawl({
      url: canonical,
      level: "error",
      message: `Import failed: ${message}`,
    });
    return { report: { url, ok: false, error: message }, discoveredLinks: [] };
  }
}

async function main(): Promise<void> {
  const { urls, discover } = parseArgs(process.argv.slice(2));
  console.log(`\nHeadout import pipeline — ${urls.length} URL(s)\n`);

  const reports: PageReport[] = [];
  const discovered = new Set<string>();
  const importedCanonicals = new Set<string>();

  for (const url of urls) {
    process.stdout.write(`→ ${url}\n`);
    const { report, discoveredLinks } = await importOne(url);
    reports.push(report);
    if (report.ok) {
      importedCanonicals.add(canonicalizeUrl(url) ?? url);
      for (const link of discoveredLinks) discovered.add(link);
      const counts = report.counts ?? {};
      console.log(
        `  ✓ ${report.title ?? "(untitled)"} [${
          report.changed ? "changed" : "unchanged"
        }] ` +
          Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(" "),
      );
    } else {
      console.log(`  ✗ ${report.error}`);
    }
  }

  console.log("\nResolving internal links across imported pages...");
  const resolved = await resolveInternalLinks();
  console.log(`  resolved ${resolved} internal link reference(s)`);

  // Queue newly-discovered blog articles (not already imported) for a future
  // crawl pass. We only enqueue here — fetching the wider crawl is out of scope.
  if (discover) {
    const toQueue = [...discovered].filter((u) => !importedCanonicals.has(u));
    await enqueueDiscovered(toQueue, "import-pipeline");
    console.log(
      `\nDiscovery: enqueued ${toQueue.length} new blog URL(s) for future crawling.`,
    );
  }

  const ok = reports.filter((r) => r.ok).length;
  const failed = reports.length - ok;
  console.log(`\nDone: ${ok} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log("Failures:");
    for (const r of reports.filter((x) => !x.ok))
      console.log(`  - ${r.url}: ${r.error}`);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Import pipeline crashed:", err);
    await pool.end();
    process.exit(1);
  });
