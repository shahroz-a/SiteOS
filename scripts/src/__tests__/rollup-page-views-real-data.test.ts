/**
 * Post-build verification: the page-view rollup never loses or double-counts
 * views, run against the REAL database.
 *
 * The fast unit suite only covers `parseArgs`. The actual correctness
 * guarantees of the rollup — fold completed past days into `page_view_daily`,
 * delete exactly those raw rows, keep today's rows raw, preserve totals
 * exactly, and be a no-op on a second run — are pure SQL that only a DB-backed
 * test can exercise. This opt-in check seeds a known fan of views (past days +
 * today) under a unique throwaway slug, drives the REAL `run()` rollup, and
 * asserts:
 *
 *  - **past days folded + raw rows deleted** — after the rollup the seeded
 *    slug has no raw `page_views` rows older than today, and one
 *    `page_view_daily` bucket per seeded past day with the exact seeded count;
 *  - **today stays raw** — today's seeded rows remain in `page_views` and are
 *    NOT in the rollup;
 *  - **no loss, no double counting** — the analytics-style union of
 *    `page_view_daily` + `page_views` for the slug equals the seeded total both
 *    BEFORE and AFTER the rollup (a day lives in exactly one tier);
 *  - **idempotent** — a second rollup in the same unit-of-work folds zero rows.
 *
 * A second test pins the rollup's OBSERVABILITY side effects: after a real
 * rollup that actually folded rows it writes exactly one `audit_logs` row
 * (action `analytics.rollup.auto`, entityType `analytics`, no human actor, the
 * rows/days/buckets summary in `after`) and one durable `crawl_logs` info line —
 * and a follow-up no-op run (nothing eligible) writes NEITHER, so the activity
 * feed never gets spammed by empty runs.
 *
 * OPT-IN + NON-DESTRUCTIVE. Like the payload round-trip and redirect-health
 * checks it touches the real DB, so it only runs when `VERIFY_REAL_DATA=1`; the
 * normal suite skips it. Every mutation happens inside an OUTER transaction that
 * is force-rolled-back at the end (via a sentinel throw), so the live database
 * is left exactly as it was — the seeded rows and the rollup they trigger never
 * commit. `run()` is handed that transaction as its executor so its own
 * apply-path unit-of-work nests as a savepoint inside the rollback boundary.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/scripts run verify:rollup
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { run } from "../rollup-page-views";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

describe.skipIf(!RUN)(
  "page-view rollup — real DB integrity (no loss, no double counting)",
  () => {
    afterAll(async () => {
      try {
        const { pool } = await import("@workspace/db");
        await pool.end();
      } catch {
        // pool may already be closed; ignore.
      }
    });

    it(
      "folds past days, keeps today raw, preserves totals, and is idempotent",
      async () => {
        const { db } = await import("@workspace/db");

        // Unique slug so seeded rows can never collide with real analytics rows
        // (page_view_daily is keyed on (day, slug)) and assertions can scope to
        // exactly what this test inserted.
        const slug = `__verify-rollup-${Date.now()}`;

        // Seeded fan-out: known counts across two completed past days and today.
        const TWO_DAYS_AGO = 3;
        const ONE_DAY_AGO = 2;
        const TODAY = 4;
        const SEEDED_PAST = TWO_DAYS_AGO + ONE_DAY_AGO;
        const SEEDED_TOTAL = SEEDED_PAST + TODAY;

        try {
          await db.transaction(async (tx) => {
            // Seed raw views at explicit timestamps. Past-day timestamps are
            // pinned to mid-day UTC so they fall strictly before today's
            // midnight-UTC cutoff regardless of the clock; today's use now().
            const midDayUtc = (daysAgo: number) => {
              const d = new Date();
              d.setUTCDate(d.getUTCDate() - daysAgo);
              d.setUTCHours(12, 0, 0, 0);
              return d;
            };
            const rows = [
              ...Array.from({ length: TWO_DAYS_AGO }, () => ({
                slug,
                pageId: null,
                viewedAt: midDayUtc(2),
              })),
              ...Array.from({ length: ONE_DAY_AGO }, () => ({
                slug,
                pageId: null,
                viewedAt: midDayUtc(1),
              })),
              ...Array.from({ length: TODAY }, () => ({
                slug,
                pageId: null,
                viewedAt: new Date(),
              })),
            ];
            const { pageViewsTable } = await import("@workspace/db");
            await tx.insert(pageViewsTable).values(rows);

            // The analytics layer's COMBINED_VIEWS union, scoped to our slug.
            // This is the exact shape `artifacts/api-server/src/lib/analytics.ts`
            // unions (rollup ∪ raw); replicated here because a leaf script
            // package can't import from an artifact. Asserting on it proves the
            // union total is what the analytics endpoint would report.
            const unionTotal = async () => {
              const res = await tx.execute<{ total: number }>(sql`
                with combined as (
                  select day::date as day, slug, views
                  from page_view_daily where slug = ${slug}
                  union all
                  select date(viewed_at) as day, slug, count(*)::int as views
                  from page_views where slug = ${slug}
                  group by date(viewed_at), slug
                )
                select coalesce(sum(views), 0)::int as total from combined
              `);
              return Number(res.rows[0]?.total ?? 0);
            };

            // BEFORE: everything is raw; the union must already total the seed.
            expect(await unionTotal()).toBe(SEEDED_TOTAL);

            // --- First rollup (apply mode) inside the rolled-back tx. ---
            const first = await run({ dryRun: false, retentionDays: 0 }, tx);
            expect(first.dryRun).toBe(false);
            // It folded at least our seeded past rows (the live table may carry
            // other past-day rows too — all confined to this rolled-back tx).
            expect(first.rolledRows).toBeGreaterThanOrEqual(SEEDED_PAST);

            // Raw past-day rows for our slug are gone; only today's remain.
            const rawForSlug = await tx.execute<{
              total: number;
              past: number;
            }>(sql`
              select
                count(*)::int as total,
                count(*) filter (where viewed_at < current_date::timestamptz)::int as past
              from page_views where slug = ${slug}
            `);
            expect(Number(rawForSlug.rows[0]?.past ?? -1)).toBe(0);
            expect(Number(rawForSlug.rows[0]?.total ?? -1)).toBe(TODAY);

            // Rollup holds exactly one bucket per seeded past day, exact counts.
            const buckets = await tx.execute<{ day: string; views: number }>(sql`
              select to_char(day, 'YYYY-MM-DD') as day, views
              from page_view_daily where slug = ${slug}
              order by day
            `);
            expect(buckets.rows.map((r) => Number(r.views))).toEqual([
              TWO_DAYS_AGO,
              ONE_DAY_AGO,
            ]);

            // AFTER: the union is unchanged — no view lost, none double-counted
            // (each day now lives in exactly one tier: past in rollup, today raw).
            expect(await unionTotal()).toBe(SEEDED_TOTAL);

            // --- Idempotency: a second rollup folds nothing. ---
            const second = await run({ dryRun: false, retentionDays: 0 }, tx);
            expect(second.rolledRows).toBe(0);
            expect(second.buckets).toBe(0);
            expect(await unionTotal()).toBe(SEEDED_TOTAL);

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: none of our seeded rows persisted.
        const leftoverRaw = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from page_views where slug = ${slug}
        `);
        expect(Number(leftoverRaw.rows[0]?.n ?? -1)).toBe(0);
        const leftoverRollup = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from page_view_daily where slug = ${slug}
        `);
        expect(Number(leftoverRollup.rows[0]?.n ?? -1)).toBe(0);
      },
      300_000,
    );

    it(
      "writes an audit_logs + crawl_logs row after a real rollup and stays quiet on a no-op run",
      async () => {
        const { db, pageViewsTable } = await import("@workspace/db");

        const slug = `__verify-rollup-obs-${Date.now()}`;

        // Seed only completed-past-day raw rows so the rollup is guaranteed to
        // fold > 0 rows and therefore emit the observability rows.
        const SEEDED_PAST = 5;

        try {
          await db.transaction(async (tx) => {
            const midDayUtc = (daysAgo: number) => {
              const d = new Date();
              d.setUTCDate(d.getUTCDate() - daysAgo);
              d.setUTCHours(12, 0, 0, 0);
              return d;
            };
            await tx.insert(pageViewsTable).values(
              Array.from({ length: SEEDED_PAST }, () => ({
                slug,
                pageId: null,
                viewedAt: midDayUtc(1),
              })),
            );

            // Count the observability rows BEFORE the rollup. The live DB may
            // already carry historical rows from real scheduled runs, so we
            // assert on the DELTA this rollup introduces, not absolute counts.
            const auditCount = async () => {
              const r = await tx.execute<{ n: number }>(sql`
                select count(*)::int as n from audit_logs
                where action = 'analytics.rollup.auto'
              `);
              return Number(r.rows[0]?.n ?? 0);
            };
            const crawlCount = async () => {
              const r = await tx.execute<{ n: number }>(sql`
                select count(*)::int as n from crawl_logs
                where url = 'page-views-rollup'
              `);
              return Number(r.rows[0]?.n ?? 0);
            };
            const auditBefore = await auditCount();
            const crawlBefore = await crawlCount();

            // --- Real rollup: it folds our seeded past rows (at least). ---
            const result = await run({ dryRun: false, retentionDays: 0 }, tx);
            expect(result.dryRun).toBe(false);
            expect(result.rolledRows).toBeGreaterThanOrEqual(SEEDED_PAST);

            // Exactly one new audit + one new crawl row were written.
            expect(await auditCount()).toBe(auditBefore + 1);
            expect(await crawlCount()).toBe(crawlBefore + 1);

            // Inspect the audit row this rollup just wrote: no human actor,
            // correct action/entity, and the run summary mirrored into `after`.
            const auditRow = await tx.execute<{
              actor_id: string | null;
              actor_email: string | null;
              actor_role: string | null;
              entity_type: string | null;
              after: {
                rolledRows?: number;
                days?: number;
                buckets?: number;
                referrerBuckets?: number;
                cutoff?: string;
              } | null;
              metadata: { source?: string } | null;
            }>(sql`
              select actor_id, actor_email, actor_role, entity_type, after, metadata
              from audit_logs
              where action = 'analytics.rollup.auto'
              order by created_at desc
              limit 1
            `);
            const audit = auditRow.rows[0];
            expect(audit?.actor_id).toBeNull();
            expect(audit?.actor_email).toBeNull();
            expect(audit?.actor_role).toBeNull();
            expect(audit?.entity_type).toBe("analytics");
            expect(audit?.metadata?.source).toBe("page-views-rollup-job");
            expect(audit?.after?.rolledRows).toBe(result.rolledRows);
            expect(audit?.after?.days).toBe(result.days);
            expect(audit?.after?.buckets).toBe(result.buckets);
            expect(audit?.after?.referrerBuckets).toBe(result.referrerBuckets);
            expect(audit?.after?.cutoff).toBe(result.cutoff);

            // Inspect the crawl row: durable info line with the rollup summary.
            const crawlRow = await tx.execute<{
              level: string;
              message: string | null;
              details: { action?: string } | null;
            }>(sql`
              select level, message, details
              from crawl_logs
              where url = 'page-views-rollup'
              order by created_at desc
              limit 1
            `);
            const crawl = crawlRow.rows[0];
            expect(crawl?.level).toBe("info");
            expect(crawl?.message).toContain("Rolled up");
            expect(crawl?.message).toContain(String(result.rolledRows));
            expect(crawl?.details?.action).toBe("page-views-rollup");

            // --- No-op run: nothing eligible remains (the first run folded
            // every completed past day in the tx), so NEITHER table grows. ---
            const auditAfterFirst = await auditCount();
            const crawlAfterFirst = await crawlCount();
            const second = await run({ dryRun: false, retentionDays: 0 }, tx);
            expect(second.rolledRows).toBe(0);
            expect(await auditCount()).toBe(auditAfterFirst);
            expect(await crawlCount()).toBe(crawlAfterFirst);

            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: no observability rows for our slug's
        // run leaked (the seeded raw rows are gone too).
        const leftoverRaw = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from page_views where slug = ${slug}
        `);
        expect(Number(leftoverRaw.rows[0]?.n ?? -1)).toBe(0);
      },
      300_000,
    );
  },
);
