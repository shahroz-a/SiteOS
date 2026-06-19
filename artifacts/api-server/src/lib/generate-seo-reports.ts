/**
 * Batch-generate `seo` validation reports across the published article corpus.
 *
 * The content explorer's Validation drill-down surfaces the LATEST
 * `validation_reports` row per page. In the imported corpus that is almost
 * always a `content-fidelity` report, because `seo`-type reports are only
 * written when an editor trips the publish gate (`runPublishGate`). As a result
 * the SEO-specific check messages (title too long, missing description, …)
 * almost never appear in the drill-down.
 *
 * This job closes that gap: it walks every published post, runs the SAME
 * validation the publish gate / SEO panel run (`runValidation` →
 * `serializeCmsPostDetail` + `buildValidationInput` + DB duplicate detection +
 * `validateSeo`) and persists a fresh `seo` report via `storeReport`. After it
 * runs, the drill-down shows real SEO failures corpus-wide.
 *
 * Safe to re-run: `validation_reports` is append-only and the explorer reads the
 * latest row per page (DISTINCT ON … ORDER BY created_at DESC), so each run just
 * refreshes the latest `seo` report for every page — exactly like the offline
 * content-fidelity `revalidate` job. `--dry-run` writes nothing.
 *
 * Usage (from the api-server package):
 *   pnpm --filter @workspace/api-server run seo:reports
 *   pnpm --filter @workspace/api-server run seo:reports -- --dry-run
 *   pnpm --filter @workspace/api-server run seo:reports -- --status=draft
 *   pnpm --filter @workspace/api-server run seo:reports -- --limit=50
 */
import { and, eq } from "drizzle-orm";
import { db, pool, pagesTable } from "@workspace/db";
import type { SeoValidationResult } from "@workspace/seo-validation";
import { runValidation, storeReport } from "./seo-validation";

export interface Options {
  dryRun: boolean;
  /** Page status to scope to (default: published). */
  status: string;
  /** Optional cap on the number of pages processed (0 = no cap). */
  limit: number;
  /** Skip this many pages (stable id order) — lets a big corpus be run in chunks. */
  offset: number;
}

export function parseArgs(argv: string[]): Options {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`${f}=`));
    return hit ? hit.slice(f.length + 1) : undefined;
  };
  const nonNeg = (raw: string | undefined): number => {
    const n = Number(raw ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const status = (val("--status") ?? "published").trim() || "published";
  return {
    dryRun: has("--dry-run"),
    status,
    limit: nonNeg(val("--limit")),
    offset: nonNeg(val("--offset")),
  };
}

export interface GenerateResult {
  /** Pages considered (published posts in scope). */
  total: number;
  /** Pages a fresh `seo` report was written for (0 in dry-run). */
  written: number;
  /** Pages skipped because they no longer resolve (race with a delete). */
  missing: number;
  /** Tally of the computed validation status across all processed pages. */
  byStatus: Record<SeoValidationResult["status"], number>;
  dryRun: boolean;
}

type RunnerDeps = {
  runValidation: typeof runValidation;
  storeReport: typeof storeReport;
};

/**
 * Run the batch. `deps` is injectable so a unit test can drive the loop without
 * a database; production uses the real `seo-validation` glue.
 */
export async function run(
  opts: Options,
  pageIds: string[],
  deps: RunnerDeps = { runValidation, storeReport },
  log: (m: string) => void = console.log,
): Promise<GenerateResult> {
  const byStatus: GenerateResult["byStatus"] = { pass: 0, warn: 0, fail: 0 };
  let written = 0;
  let missing = 0;
  let processed = 0;

  for (const pageId of pageIds) {
    const outcome = await deps.runValidation(pageId);
    processed += 1;
    if (!outcome) {
      missing += 1;
      continue;
    }
    byStatus[outcome.result.status] += 1;
    if (!opts.dryRun) {
      await deps.storeReport(pageId, outcome.result);
      written += 1;
    }
    if (processed % 100 === 0) {
      log(`  …processed ${processed}/${pageIds.length}`);
    }
  }

  return {
    total: pageIds.length,
    written,
    missing,
    byStatus,
    dryRun: opts.dryRun,
  };
}

/** Load the page ids in scope (post pages of the requested status). */
async function loadPageIds(opts: Options): Promise<string[]> {
  const base = db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(
      and(
        eq(pagesTable.pageType, "post"),
        eq(pagesTable.status, opts.status as (typeof pagesTable.status.enumValues)[number]),
      ),
    )
    .orderBy(pagesTable.id);
  const limited = opts.limit > 0 ? base.limit(opts.limit) : base;
  const rows = opts.offset > 0 ? await limited.offset(opts.offset) : await limited;
  return rows.map((r) => r.id);
}

export async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[generate-seo-reports] DATABASE_URL is not set; nothing to do.");
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  try {
    const pageIds = await loadPageIds(opts);
    console.log(
      `[generate-seo-reports] ${opts.dryRun ? "(dry-run) " : ""}validating ` +
        `${pageIds.length} '${opts.status}' post(s)…`,
    );
    const result = await run(opts, pageIds);
    const tag = result.dryRun ? " (dry-run, no reports written)" : "";
    console.log(
      `[generate-seo-reports] done: pass=${result.byStatus.pass} ` +
        `warn=${result.byStatus.warn} fail=${result.byStatus.fail} ` +
        `(reports written ${result.written}, missing ${result.missing})${tag}.`,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  main().catch((error) => {
    console.error("[generate-seo-reports]", error);
    process.exit(1);
  });
}
