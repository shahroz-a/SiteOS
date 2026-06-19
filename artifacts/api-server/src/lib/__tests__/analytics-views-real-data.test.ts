/**
 * Post-build verification: the analytics dashboard's view counts, fed by
 * `viewsQuery()` and `topReferrersQuery()`
 * (`artifacts/api-server/src/lib/analytics.ts`), run against the REAL database.
 *
 * The trickiest, most regression-prone part of the analytics snapshot is the
 * two-tier view counting. Every view aggregate reads a `union all` over the
 * pre-aggregated rollup tables (`page_view_daily` / `page_view_referrer_daily`,
 * holding completed past days) AND the still-raw `page_views` event log (the
 * current day plus any not-yet-rolled days). The scheduled rollup job guarantees
 * a given calendar day lives in EXACTLY ONE tier, so the union can never double
 * count — but nothing automatically verifies that the union actually combines
 * both tiers ADDITIVELY (each raw row counted once, each rollup row counted
 * once). A future change to the rollup boundary or the union SQL — e.g. dropping
 * a tier, swapping `union all` for a join, or accidentally double-reading a day —
 * could silently double-count or drop views with no test failing. This is the
 * test that fails when that happens. It seeds known rows in BOTH tiers for the
 * SAME day and for DIFFERENT days and asserts:
 *
 *  - **viewsQuery totals combine both tiers** — `total`, `last7Days`,
 *    `last30Days` equal the exact sum of the seeded raw + rollup views, with the
 *    calendar windows applied correctly and a day present in both tiers summed
 *    (not dropped, not duplicated);
 *  - **the daily series spans 30 gap-filled days** — each seeded day shows its
 *    combined (raw + rollup) value, days with no views are 0, and a day older
 *    than 30 days is excluded;
 *  - **topReferrers combine both tiers and fold "Direct / none"** — host totals
 *    sum the raw + referrer-rollup tiers, and a missing/empty referrer host (raw
 *    NULL referrer + the rollup's `''` bucket) folds together into the single
 *    `host: ""` "Direct / none" bucket.
 *
 * OPT-IN + NON-DESTRUCTIVE. Like the analytics-maintenance / publish-scheduled /
 * rollup / redirect-health real-DB checks it touches the real DB, so it only
 * runs when `VERIFY_REAL_DATA=1`; the normal suite skips it. To make the totals
 * exactly assertable, it first clears all three view tables INSIDE an OUTER
 * transaction that is force-rolled-back at the end via a sentinel throw, then
 * seeds its own known rows — so the live database (every real view, raw or
 * rolled up) is left exactly as it was. `viewsQuery` / `topReferrersQuery` are
 * handed that transaction as their executor so their reads run inside the same
 * rollback boundary and see only the seeded data.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/api-server run verify:analytics-views
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { topReferrersQuery, viewsQuery } from "../analytics.js";
import type { Executor } from "../cms-content.js";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

describe.skipIf(!RUN)(
  "viewsQuery / topReferrersQuery — real DB (two-tier union combines rollup + raw with no double counting)",
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
      "sums raw + rollup tiers additively across same and different days, and folds Direct/none",
      async () => {
        const { db } = await import("@workspace/db");

        try {
          await db.transaction(async (tx) => {
            const exec = tx as unknown as Executor;

            // --- Clear all three view tables INSIDE the rolled-back tx so the
            // seeded data is the only data the union sees and totals are exactly
            // assertable. Rollback restores every real row afterwards. ---
            await tx.execute(sql`delete from page_views`);
            await tx.execute(sql`delete from page_view_daily`);
            await tx.execute(sql`delete from page_view_referrer_daily`);

            // All day arithmetic is done in the DB relative to current_date (the
            // same anchor viewsQuery's windows use), so the test never drifts
            // from the server's notion of "today". Raw events sit at noon so
            // date(viewed_at) lands on the intended calendar day in any tz.

            // --- Raw page_views (the current-day / not-yet-rolled tier). ---
            // today:   alpha x3 (google, google, direct) + beta x1 (t.co) = 4
            // today-3: alpha x1 (google) — SAME day as a rollup row below, so
            //          the union must SUM both tiers for today-3 (no drop).
            await tx.execute(sql`
              insert into page_views (slug, referrer_host, viewed_at) values
                ('alpha', 'www.google.com', current_date + interval '12 hours'),
                ('alpha', 'www.google.com', current_date + interval '12 hours'),
                ('alpha', null,             current_date + interval '12 hours'),
                ('beta',  't.co',           current_date + interval '12 hours'),
                ('alpha', 'www.google.com', current_date - interval '3 days' + interval '12 hours')
            `);

            // --- page_view_daily (the completed-past-day rollup tier). ---
            // today-3:  alpha 5  (overlaps the raw today-3 row → tests SAME day)
            // today-10: beta  7  (different day, inside the 30d window)
            // today-40: gamma 100 (older than 30d → excluded from windows/series)
            await tx.execute(sql`
              insert into page_view_daily (day, slug, views) values
                (current_date - 3,  'alpha', 5),
                (current_date - 10, 'beta',  7),
                (current_date - 40, 'gamma', 100)
            `);

            // --- page_view_referrer_daily (the referrer rollup tier). Seeded
            // independently of the view rollup above — only the referrer host
            // matters here, not the per-slug view counts. ---
            // today-3:  google 4
            // today-10: '' (direct) 9
            // today-40: bing 100
            await tx.execute(sql`
              insert into page_view_referrer_daily (day, referrer_host, views) values
                (current_date - 3,  'www.google.com', 4),
                (current_date - 10, '',               9),
                (current_date - 40, 'www.bing.com',   100)
            `);

            // Date labels (matching viewsQuery's to_char period format) so the
            // daily-series assertions can pick out the seeded days by name.
            const labels = await tx.execute<{
              d0: string;
              d3: string;
              d10: string;
            }>(sql`
              select
                to_char(current_date,      'YYYY-MM-DD') as d0,
                to_char(current_date - 3,  'YYYY-MM-DD') as d3,
                to_char(current_date - 10, 'YYYY-MM-DD') as d10
            `);
            const { d0, d3, d10 } = labels.rows[0]!;

            // === viewsQuery: totals combine both tiers additively. ===
            // total   = raw(5) + rollup(5+7+100=112)            = 117
            // last7   = today raw(4) + today-3 raw(1)+rollup(5) = 10
            // last30  = last7(10) + today-10 rollup(7)          = 17
            //           (today-40's 100 is older than 30d → excluded)
            const views = await viewsQuery(exec);
            expect(views.total).toBe(117);
            expect(views.last7Days).toBe(10);
            expect(views.last30Days).toBe(17);

            // Daily series: always 30 gap-filled days, summing to last30.
            expect(views.daily).toHaveLength(30);
            const dailySum = views.daily.reduce((acc, p) => acc + p.value, 0);
            expect(dailySum).toBe(17);

            // Each seeded day shows its COMBINED (raw + rollup) value.
            const valueOn = (period: string) =>
              views.daily.find((p) => p.period === period)?.value;
            expect(valueOn(d0)).toBe(4); // today: raw only
            expect(valueOn(d3)).toBe(6); // today-3: raw 1 + rollup 5 (same day)
            expect(valueOn(d10)).toBe(7); // today-10: rollup only
            // A day with no views is gap-filled to 0, not absent.
            const zeroDay = views.daily.find(
              (p) => p.period !== d0 && p.period !== d3 && p.period !== d10,
            );
            expect(zeroDay?.value).toBe(0);

            // === topReferrers: combine both tiers, fold Direct/none. ===
            // bing   = rollup 100                       = 100
            // ''     = raw null(1) + rollup ''(9)       = 10  (Direct / none)
            // google = raw(3) + rollup(4)               = 7
            // t.co   = raw(1)                           = 1
            const referrers = await topReferrersQuery(exec);
            const byHost = new Map(referrers.map((r) => [r.host, r.views]));
            expect(byHost.get("www.bing.com")).toBe(100);
            expect(byHost.get("")).toBe(10); // raw NULL + rollup '' folded together
            expect(byHost.get("www.google.com")).toBe(7);
            expect(byHost.get("t.co")).toBe(1);

            // Exactly four distinct host buckets — the null/'' fold did not leave
            // a stray bucket behind, and no tier was dropped or duplicated.
            expect(referrers).toHaveLength(4);

            // Ordered by views desc (no ties in this dataset).
            expect(referrers.map((r) => r.host)).toEqual([
              "www.bing.com",
              "",
              "www.google.com",
              "t.co",
            ]);

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }
      },
      300_000,
    );
  },
);
