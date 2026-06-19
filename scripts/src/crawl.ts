import {
  runCrawl,
  runDiscovery,
  runReports,
  queueStats,
  resetQueue,
  resetFailedToPending,
  type CrawlerConfig,
} from "./crawler";

interface CliFlags {
  discover: boolean;
  crawl: boolean;
  reports: boolean;
  reset: boolean;
  retryFailed: boolean;
  status: boolean;
  limit: number;
  concurrency: number | null;
  noBrowser: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    discover: false,
    crawl: false,
    reports: false,
    reset: false,
    retryFailed: false,
    status: false,
    limit: 0,
    concurrency: null,
    noBrowser: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--discover":
        flags.discover = true;
        break;
      case "--crawl":
        flags.crawl = true;
        break;
      case "--reports":
        flags.reports = true;
        break;
      case "--reset":
        flags.reset = true;
        break;
      case "--retry-failed":
        flags.retryFailed = true;
        break;
      case "--status":
        flags.status = true;
        break;
      case "--resume":
        // Resume is the default behaviour (queue is persistent); accepted as a no-op flag.
        flags.crawl = true;
        break;
      case "--no-browser":
        flags.noBrowser = true;
        break;
      case "--all":
        flags.discover = true;
        flags.crawl = true;
        flags.reports = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      default:
        if (arg.startsWith("--limit=")) flags.limit = Number.parseInt(arg.slice(8), 10) || 0;
        else if (arg === "--limit") flags.limit = Number.parseInt(argv[++i] ?? "0", 10) || 0;
        else if (arg.startsWith("--concurrency="))
          flags.concurrency = Number.parseInt(arg.slice(14), 10) || null;
        else if (arg === "--concurrency")
          flags.concurrency = Number.parseInt(argv[++i] ?? "", 10) || null;
        else console.warn(`Unknown flag ignored: ${arg}`);
    }
  }
  return flags;
}

const HELP = `Headout blog crawler & extraction engine

Usage: pnpm --filter @workspace/scripts run crawl -- [flags]

Flags:
  --discover            Discover URLs from the 7 sitemaps and enqueue them (idempotent)
  --crawl               Process the queue: fetch, extract, normalize, validate, store
  --reports             Generate migration deliverable reports into ./reports
  --all                 Run discover + crawl + reports in sequence
  --resume              Alias for --crawl (the DB queue is always resumable)
  --reset               Clear the crawl queue before running
  --retry-failed        Reset permanently-failed rows to pending (attempts=0) so
                        the next crawl re-classifies them under current skip rules
  --status              Print queue statistics and exit
  --limit=N             Process at most N pages this run (0 = unlimited)
  --concurrency=N       Override worker concurrency
  --no-browser          Force the HTTP fetch path (skip Playwright)
  -h, --help            Show this help

Examples:
  pnpm --filter @workspace/scripts run crawl -- --discover
  pnpm --filter @workspace/scripts run crawl -- --crawl --limit=20
  pnpm --filter @workspace/scripts run crawl -- --all --limit=50
`;

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(HELP);
    return;
  }

  // Default to a full run when no action flag is given.
  if (!flags.discover && !flags.crawl && !flags.reports && !flags.status && !flags.reset) {
    flags.discover = true;
    flags.crawl = true;
    flags.reports = true;
  }

  if (flags.reset) {
    console.log("Resetting crawl queue…");
    await resetQueue();
  }

  if (flags.retryFailed) {
    const reset = await resetFailedToPending();
    console.log(`Reset ${reset} failed row(s) to pending for re-classification.`);
  }

  if (flags.status) {
    const stats = await queueStats();
    console.log("Queue statistics:", JSON.stringify(stats, null, 2));
    return;
  }

  if (flags.discover) {
    await runDiscovery();
  }

  if (flags.crawl) {
    const config: Partial<CrawlerConfig> = {};
    if (flags.concurrency) config.concurrency = flags.concurrency;
    if (flags.noBrowser) config.useBrowser = false;
    await runCrawl({ limit: flags.limit, config });
  }

  if (flags.reports) {
    await runReports();
  }
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Crawl failed:", err);
    process.exit(1);
  });
