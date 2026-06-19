/**
 * Post-build verification: the analytics snapshot's `maintenance` indicator,
 * fed by `maintenanceQuery()` (`artifacts/api-server/src/lib/analytics.ts`),
 * reads the latest null-actor `analytics.rollup.auto` audit_logs row the
 * scheduled page-views rollup job writes and shapes it into the operator-facing
 * "last automated cleanup" panel. That code is pure SQL — a single SELECT that
 * coalesces the `after` JSON fields and picks the most-recent row by
 * `created_at` — so only a DB-backed test can exercise its real behaviour. This
 * opt-in check, inside an always-rolled-back transaction, asserts:
 *
 *  - **null when never run** — with no `analytics.rollup.auto` rows present,
 *    maintenanceQuery returns null (the panel stays hidden);
 *  - **latest run wins** — given several rollup-auto rows with different
 *    timestamps, it returns the most-recent one's
 *    rolledRows/days/buckets/referrerBuckets/cutoff, mapped from its `after`
 *    JSON, and ignores older rows;
 *  - **missing fields default safely** — an `after` with no numeric fields
 *    coalesces to zeros / empty cutoff rather than NaN/undefined.
 *
 * OPT-IN + NON-DESTRUCTIVE. Like the publish-scheduled / rollup / redirect-health
 * real-DB checks it touches the real DB, so it only runs when
 * `VERIFY_REAL_DATA=1`; the normal suite skips it. Every mutation (including the
 * delete that clears existing rollup-auto rows for the null case) happens inside
 * an OUTER transaction that is force-rolled-back at the end via a sentinel throw,
 * so the live database is left exactly as it was. `maintenanceQuery` is handed
 * that transaction as its executor so its SELECT runs inside the same boundary.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/api-server run verify:analytics-maintenance
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { maintenanceQuery } from "../analytics.js";
import type { Executor } from "../cms-content.js";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

describe.skipIf(!RUN)(
  "maintenanceQuery — real DB (null when never run, latest rollup-auto row wins, after-JSON mapped)",
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
      "returns null with no rows, then the most-recent run's mapped fields",
      async () => {
        const { db, auditLogsTable } = await import("@workspace/db");

        try {
          await db.transaction(async (tx) => {
            const exec = tx as unknown as Executor;

            // --- Null case: clear every analytics.rollup.auto row inside the
            // rolled-back tx, so the table genuinely has none. ---
            await tx.execute(
              sql`delete from audit_logs where action = 'analytics.rollup.auto'`,
            );
            expect(await maintenanceQuery(exec)).toBeNull();

            // --- Seed three rollup-auto rows with distinct timestamps. The
            // newest one's `after` is what maintenanceQuery must return. ---
            const older = new Date("2026-06-01T04:00:00.000Z");
            const middle = new Date("2026-06-10T04:00:00.000Z");
            const newest = new Date("2026-06-18T04:00:00.000Z");

            await tx.insert(auditLogsTable).values([
              {
                action: "analytics.rollup.auto",
                entityType: "analytics",
                createdAt: older,
                after: {
                  rolledRows: 1,
                  days: 1,
                  buckets: 1,
                  referrerBuckets: 1,
                  cutoff: "2026-05-31",
                },
              },
              {
                action: "analytics.rollup.auto",
                entityType: "analytics",
                createdAt: newest,
                after: {
                  rolledRows: 4242,
                  days: 7,
                  buckets: 321,
                  referrerBuckets: 58,
                  cutoff: "2026-06-17",
                },
              },
              {
                action: "analytics.rollup.auto",
                entityType: "analytics",
                createdAt: middle,
                after: {
                  rolledRows: 99,
                  days: 3,
                  buckets: 40,
                  referrerBuckets: 12,
                  cutoff: "2026-06-09",
                },
              },
            ]);

            const result = await maintenanceQuery(exec);
            expect(result).not.toBeNull();
            expect(result!.lastRunAt).toBe(newest.toISOString());
            expect(result!.rolledRows).toBe(4242);
            expect(result!.days).toBe(7);
            expect(result!.buckets).toBe(321);
            expect(result!.referrerBuckets).toBe(58);
            expect(result!.cutoff).toBe("2026-06-17");

            // --- A newer row with an `after` missing every numeric field must
            // coalesce to zeros / empty cutoff (never NaN/undefined). ---
            await tx.insert(auditLogsTable).values({
              action: "analytics.rollup.auto",
              entityType: "analytics",
              createdAt: new Date("2026-06-19T04:00:00.000Z"),
              after: { note: "no-op run" },
            });

            const sparse = await maintenanceQuery(exec);
            expect(sparse!.rolledRows).toBe(0);
            expect(sparse!.days).toBe(0);
            expect(sparse!.buckets).toBe(0);
            expect(sparse!.referrerBuckets).toBe(0);
            expect(sparse!.cutoff).toBe("");

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
