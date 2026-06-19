/**
 * Auto-deactivate redirects whose targets are confirmed dead.
 *
 * A preserved redirect is only useful while its destination still exists. When
 * the target is gone, the redirect quietly forwards readers and crawlers into a
 * 404. This job checks every ACTIVE redirect's target and flips `isActive` to
 * false for the ones that are confirmed dead — so the static blog stops
 * forwarding into a dead end — while being conservative enough never to retire a
 * working redirect:
 *
 *  - **On-blog targets** (`/blog/...`) are deterministic: the target either
 *    resolves to a page in our corpus (any status — a held-back draft still
 *    counts, it's pending review, not gone) or it doesn't. A missing target is
 *    deactivated on the first run.
 *  - **Off-blog targets** are a network reading and so fallible: a single 404/410
 *    or a timeout never acts. Confirmed-dead readings must accumulate across runs
 *    (see `OFF_BLOG_DEAD_THRESHOLD`); any healthy reading resets the counter.
 *
 * Every change is auditable and reversible: the redirect row records
 * `deactivatedReason`/`deactivatedAt`, a `crawl_logs` warn line is written, and a
 * `redirect-deactivations.json` report lists exactly what changed (plus
 * "at-risk" off-blog targets that failed once but haven't hit the threshold yet)
 * so an operator can review and undo by flipping `isActive` back.
 *
 * The decision policy lives in `./prerender/redirect-target-health.ts` (pure,
 * unit-tested); this runner only gathers evidence and applies the verdict.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run redirect:health            # apply
 *   pnpm --filter @workspace/scripts run redirect:health -- --dry-run
 *   pnpm --filter @workspace/scripts run redirect:health -- --no-network
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  pagesTable,
  categoriesTable,
  authorsTable,
  redirectsTable,
  crawlLogsTable,
} from "@workspace/db";
import { redirectTargetUrl } from "./prerender/redirects";
import {
  decideHealth,
  normalizeTargetPath,
  readingVerdict,
  targetKind,
  type DeactivationReason,
  type TargetReading,
} from "./prerender/redirect-target-health";
import { DEFAULT_CONFIG } from "./crawler/config";

interface Options {
  dryRun: boolean;
  /** Skip off-blog HTTP probes (on-blog deterministic checks still run). */
  noNetwork: boolean;
  /** Max concurrent off-blog probes. */
  concurrency: number;
  /** Per-probe timeout in ms. */
  timeoutMs: number;
  reportDir: string;
}

function parseArgs(argv: string[]): Options {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`${f}=`));
    return hit ? hit.slice(f.length + 1) : undefined;
  };
  return {
    dryRun: has("--dry-run"),
    noNetwork: has("--no-network"),
    concurrency: Number(val("--concurrency") ?? 5) || 5,
    timeoutMs: Number(val("--timeout") ?? 15000) || 15000,
    reportDir: val("--report-dir") ?? DEFAULT_CONFIG.reportDir,
  };
}

/**
 * Build the set of normalised paths the blog actually serves, so an on-blog
 * redirect target can be checked for existence deterministically. Includes every
 * page's pathname in ANY status (a held-back draft is pending review, not dead),
 * the explicit blog category/author routes, and the index.
 */
export async function loadServedPaths(): Promise<Set<string>> {
  const served = new Set<string>();
  served.add(normalizeTargetPath("/blog/"));

  const pages = await db.select({ pathname: pagesTable.pathname }).from(pagesTable);
  for (const p of pages) {
    if (p.pathname) served.add(normalizeTargetPath(p.pathname));
  }

  const cats = await db.select({ slug: categoriesTable.slug }).from(categoriesTable);
  for (const c of cats) {
    if (c.slug) served.add(normalizeTargetPath(`/blog/category/${c.slug}`));
  }

  const authors = await db.select({ slug: authorsTable.slug }).from(authorsTable);
  for (const a of authors) {
    if (a.slug) served.add(normalizeTargetPath(`/blog/author/${a.slug}`));
  }

  return served;
}

/**
 * Probe an off-blog target for its final HTTP status (following redirects), or
 * `null` if the request failed. Tries HEAD first and falls back to GET when the
 * origin rejects HEAD (405/501) — some hosts only answer GET.
 */
export async function probeStatus(url: string, timeoutMs: number): Promise<number | null> {
  const headers = {
    "user-agent": DEFAULT_CONFIG.userAgent,
    accept: "text/html,application/xhtml+xml,*/*",
  };
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
    return res.status;
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

interface ActiveRedirect {
  id: string;
  fromPath: string;
  toPath: string;
  targetCheckFailures: number;
}

interface ChangeEntry {
  id: string;
  fromPath: string;
  toPath: string;
  kind: "on-blog" | "off-blog";
  reason: DeactivationReason | null;
  status: number | null;
  failures: number;
}

export interface RedirectHealthResult {
  checked: number;
  deactivated: ChangeEntry[];
  /** Off-blog targets confirmed dead this run but still below the threshold. */
  atRisk: ChangeEntry[];
  reportFile: string;
  dryRun: boolean;
}

export async function run(opts: Options): Promise<RedirectHealthResult> {
  const active: ActiveRedirect[] = await db
    .select({
      id: redirectsTable.id,
      fromPath: redirectsTable.fromPath,
      toPath: redirectsTable.toPath,
      targetCheckFailures: redirectsTable.targetCheckFailures,
    })
    .from(redirectsTable)
    .where(eq(redirectsTable.isActive, true));

  const served = await loadServedPaths();

  // Split by kind. On-blog is resolved against the corpus (deterministic);
  // off-blog needs a network probe (unless --no-network).
  const offBlog = active.filter((r) => targetKind(r.toPath) === "off-blog");
  const statusByUrl = new Map<string, number | null>();
  if (!opts.noNetwork) {
    const urls = [...new Set(offBlog.map((r) => redirectTargetUrl(r.toPath)))];
    const statuses = await mapLimit(urls, opts.concurrency, (u) =>
      probeStatus(u, opts.timeoutMs),
    );
    urls.forEach((u, i) => statusByUrl.set(u, statuses[i] ?? null));
  }

  const deactivated: ChangeEntry[] = [];
  const atRisk: ChangeEntry[] = [];

  for (const r of active) {
    const kind = targetKind(r.toPath);
    let reading: TargetReading;
    let status: number | null = null;
    if (kind === "on-blog") {
      reading = { kind, exists: served.has(normalizeTargetPath(r.toPath)) };
    } else {
      if (opts.noNetwork) continue; // can't judge off-blog without the network
      status = statusByUrl.get(redirectTargetUrl(r.toPath)) ?? null;
      reading = { kind, status };
    }

    const verdict = readingVerdict(reading);
    const decision = decideHealth(kind, verdict, r.targetCheckFailures);

    // Persist bookkeeping for every checked redirect (so off-blog corroboration
    // carries across runs), then deactivate when the policy says so.
    if (!opts.dryRun) {
      await db
        .update(redirectsTable)
        .set({
          targetCheckFailures: decision.failures,
          targetCheckedAt: new Date(),
          targetLastStatus: status,
          ...(decision.deactivate
            ? {
                isActive: false,
                deactivatedReason: decision.reason,
                deactivatedAt: new Date(),
              }
            : {}),
        })
        .where(eq(redirectsTable.id, r.id));
    }

    const entry: ChangeEntry = {
      id: r.id,
      fromPath: r.fromPath,
      toPath: r.toPath,
      kind,
      reason: decision.reason,
      status,
      failures: decision.failures,
    };

    if (decision.deactivate) {
      deactivated.push(entry);
      if (!opts.dryRun) {
        // Best-effort audit line; never let a log write fail the job.
        await db
          .insert(crawlLogsTable)
          .values({
            url: r.fromPath,
            level: "warn",
            httpStatus: status,
            message: `Auto-deactivated redirect ${r.fromPath} -> ${r.toPath} (${decision.reason})`,
            details: { ...entry, action: "deactivate-redirect" },
          })
          .catch(() => {});
      }
    } else if (kind === "off-blog" && verdict === "dead") {
      // Confirmed dead once but not yet at the threshold — surface for review.
      atRisk.push(entry);
    }
  }

  const dir = path.resolve(process.cwd(), "..", opts.reportDir);
  await mkdir(dir, { recursive: true }).catch(async () => {
    await mkdir(path.resolve(process.cwd(), opts.reportDir), { recursive: true });
  });
  const reportFile = path.join(dir, "redirect-deactivations.json");
  await writeFile(
    reportFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dryRun: opts.dryRun,
        offBlogDeadThreshold: 2,
        checked: active.length,
        deactivatedCount: deactivated.length,
        atRiskCount: atRisk.length,
        deactivated,
        atRisk,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    checked: active.length,
    deactivated,
    atRisk,
    reportFile,
    dryRun: opts.dryRun,
  };
}

export async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[redirect-health] DATABASE_URL is not set; nothing to do.");
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  try {
    const result = await run(opts);
    const tag = result.dryRun ? " (dry-run, no changes written)" : "";
    console.log(
      `[redirect-health] Checked ${result.checked} active redirects; ` +
        `deactivated ${result.deactivated.length}, ${result.atRisk.length} off-blog at-risk${tag}.`,
    );
    console.log(`[redirect-health] Report: ${result.reportFile}`);
    // Echo the per-redirect outcomes to stdout so a scheduled run is fully
    // observable from the deployment logs alone — the JSON report file lives on
    // ephemeral storage in a scheduled deployment and is gone after the run,
    // while the deactivations are also persisted to `crawl_logs` in the DB.
    for (const e of result.deactivated) {
      console.log(
        `[redirect-health] deactivated ${e.fromPath} -> ${e.toPath} ` +
          `(${e.kind}, reason=${e.reason}, status=${e.status ?? "n/a"})`,
      );
    }
    for (const e of result.atRisk) {
      console.log(
        `[redirect-health] at-risk ${e.fromPath} -> ${e.toPath} ` +
          `(off-blog dead, failures=${e.failures}, status=${e.status ?? "n/a"})`,
      );
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error("[redirect-health]", error);
    process.exit(1);
  });
}
