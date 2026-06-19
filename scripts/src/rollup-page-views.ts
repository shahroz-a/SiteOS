/**
 * Keep the raw `page_views` event log from growing forever.
 *
 * Every public article view inserts one row into `page_views`. Left alone that
 * table expands without bound — slowing the analytics aggregates and bloating
 * the database. This job folds every COMPLETED past day's raw rows into the
 * `page_view_daily` rollup (one row per day+slug) and then deletes those raw
 * rows, so storage stays bounded by content × time instead of by traffic.
 *
 * Correctness invariant: only days strictly before the current UTC date are
 * rolled up, so live inserts for "today" are never raced, and a day's rollup +
 * raw-delete happen in ONE transaction. The analytics layer therefore sees each
 * calendar day in exactly one tier (rollup OR raw) and can union them without
 * double counting. The job is idempotent: a second run finds no past-day raw
 * rows left to fold.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run views:rollup            # apply
 *   pnpm --filter @workspace/scripts run views:rollup -- --dry-run
 *   pnpm --filter @workspace/scripts run views:rollup -- --retention-days=0
 *
 * `--retention-days=N` keeps the most recent N completed days as RAW rows
 * (rolled up only once older than that), in case you want a window of raw event
 * data for ad-hoc inspection. Default 0: roll up every completed day.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

interface Options {
  dryRun: boolean;
  /** Keep this many most-recent completed days as raw (not yet rolled up). */
  retentionDays: number;
}

export function parseArgs(argv: string[]): Options {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`${f}=`));
    return hit ? hit.slice(f.length + 1) : undefined;
  };
  const retention = Number(val("--retention-days") ?? 0);
  return {
    dryRun: has("--dry-run"),
    retentionDays: Number.isFinite(retention) && retention > 0 ? Math.floor(retention) : 0,
  };
}

export interface RollupResult {
  /** Distinct (day, slug) buckets written/updated in the rollup. */
  buckets: number;
  /** Raw `page_views` rows folded into the rollup and deleted. */
  rolledRows: number;
  /** Calendar days (UTC) that were rolled up. */
  days: number;
  /** Exclusive upper bound: raw rows with viewed_at < this were eligible. */
  cutoff: string;
  dryRun: boolean;
}

/**
 * Roll up every completed day older than the retention window. Runs inside a
 * single transaction: aggregate the eligible raw rows into `page_view_daily`
 * (summing into any existing bucket), count what we folded, then delete exactly
 * those rows. Because rolled-up days are immutable (no new view ever lands on a
 * past day) and deleted atomically, the rollup and raw tables never both hold
 * the same day.
 */
export async function run(opts: Options): Promise<RollupResult> {
  // Exclusive cutoff: start of (today - retentionDays) in UTC. Rows strictly
  // before this are complete past days eligible for rollup. retentionDays is a
  // sanitized non-negative integer (parseArgs floors/clamps it), so inlining it
  // with sql.raw is injection-safe — and it must be a literal, not a bind param,
  // or Postgres can't resolve the `date - integer` operator (42846).
  const cutoffSql = sql`(current_date - ${sql.raw(String(opts.retentionDays))})::timestamptz`;

  if (opts.dryRun) {
    const previewRes = await db.execute<{
      buckets: number;
      rolled_rows: number;
      days: number;
      cutoff: string;
    }>(sql`
      select
        count(distinct (date(viewed_at), slug))::int as buckets,
        count(*)::int as rolled_rows,
        count(distinct date(viewed_at))::int as days,
        to_char(${cutoffSql}, 'YYYY-MM-DD"T"HH24:MI:SSOF') as cutoff
      from page_views
      where viewed_at < ${cutoffSql}
    `);
    const p = previewRes.rows[0];
    return {
      buckets: Number(p?.buckets ?? 0),
      rolledRows: Number(p?.rolled_rows ?? 0),
      days: Number(p?.days ?? 0),
      cutoff: String(p?.cutoff ?? ""),
      dryRun: true,
    };
  }

  return db.transaction(async (tx) => {
    // 1) Fold eligible raw rows into the rollup. Summing into existing buckets
    //    keeps the job safe to re-run and tolerant of a future where a day is
    //    partially present.
    const upsertRes = await tx.execute<{ count: number }>(sql`
      with agg as (
        select date(viewed_at) as day, slug, max(page_id::text)::uuid as page_id, count(*)::int as views
        from page_views
        where viewed_at < ${cutoffSql}
        group by date(viewed_at), slug
      ),
      upsert as (
        insert into page_view_daily (day, page_id, slug, views, updated_at)
        select day, page_id, slug, views, now() from agg
        on conflict (day, slug) do update
          set views = page_view_daily.views + excluded.views,
              page_id = coalesce(excluded.page_id, page_view_daily.page_id),
              updated_at = now()
        returning 1
      )
      select count(*)::int as count from upsert
    `);
    const buckets = Number(upsertRes.rows[0]?.count ?? 0);

    // 2) Delete exactly the raw rows we just folded (same predicate, same tx).
    const delRes = await tx.execute<{
      rolled_rows: number;
      days: number;
      cutoff: string;
    }>(sql`
      with del as (
        delete from page_views
        where viewed_at < ${cutoffSql}
        returning viewed_at
      )
      select
        count(*)::int as rolled_rows,
        count(distinct date(viewed_at))::int as days,
        to_char(${cutoffSql}, 'YYYY-MM-DD"T"HH24:MI:SSOF') as cutoff
      from del
    `);
    const d = delRes.rows[0];

    return {
      buckets,
      rolledRows: Number(d?.rolled_rows ?? 0),
      days: Number(d?.days ?? 0),
      cutoff: String(d?.cutoff ?? ""),
      dryRun: false,
    };
  });
}

export async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[rollup-page-views] DATABASE_URL is not set; nothing to do.");
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  try {
    const result = await run(opts);
    const tag = result.dryRun ? " (dry-run, no changes written)" : "";
    console.log(
      `[rollup-page-views] Rolled up ${result.rolledRows} raw page_views ` +
        `across ${result.days} day(s) into ${result.buckets} daily bucket(s); ` +
        `cutoff < ${result.cutoff}${tag}.`,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error("[rollup-page-views]", error);
    process.exit(1);
  });
}
