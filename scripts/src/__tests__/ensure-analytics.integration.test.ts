/**
 * Opt-in live-DB test that proves the analytics self-heal (`ensureAnalytics`)
 * actually restores what a dev-DB rollback / checkpoint restore can wipe.
 *
 * `ensure-analytics.ts` re-applies the `page_views`, `page_view_daily` and
 * `page_view_referrer_daily` tables plus their 7 indexes — none of which are in
 * any drizzle migration journal. Those objects are otherwise only verified by
 * hand, so a regression in the self-heal DDL (wrong column type, missing index,
 * wrong index name) would go uncaught until page-view recording or the analytics
 * aggregates silently broke. This test captures that verification automatically.
 *
 * It runs inside a SINGLE database transaction that is ALWAYS rolled back, so the
 * live database is never mutated. Inside the tx it:
 *   1. drops a representative analytics index AND a representative analytics
 *      table (the wipe a rollback would cause) and asserts they are really gone;
 *   2. runs `ensureAnalytics(log, tx)` against the same transaction;
 *   3. asserts every analytics table is back with the right key columns/types and
 *      every analytics index is restored.
 *
 * Because it touches the real DB it only runs when `VERIFY_CMS_WRITE=1` is set;
 * the normal suite skips it. It is a no-op on a healthy DB (the function is
 * idempotent) and leaves the schema exactly as it found it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm --filter @workspace/scripts exec vitest \
 *   run src/__tests__/ensure-analytics.integration.test.ts`
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { ensureAnalytics, type Executor } from "../ensure-analytics";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

const silent = () => {};

const ANALYTICS_TABLES = [
  "page_views",
  "page_view_daily",
  "page_view_referrer_daily",
] as const;

const ANALYTICS_INDEXES = [
  "page_views_page_idx",
  "page_views_viewed_at_idx",
  "page_views_slug_idx",
  "page_view_daily_day_idx",
  "page_view_daily_page_idx",
  "page_view_daily_slug_idx",
  "page_view_referrer_daily_day_idx",
] as const;

describe.skipIf(!RUN)(
  "ensureAnalytics — restores what a rollback wipes (live DB, rolled back)",
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
      "re-creates the analytics tables and indexes",
      async () => {
        const { db } = await import("@workspace/db");

        const tableExists = async (tx: Executor, name: string) =>
          (
            await tx.execute(
              sql`SELECT 1 FROM pg_class WHERE relkind = 'r' AND relname = ${name} LIMIT 1`,
            )
          ).rows.length > 0;

        const indexExists = async (tx: Executor, name: string) =>
          (
            await tx.execute(
              sql`SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = ${name} LIMIT 1`,
            )
          ).rows.length > 0;

        const columnType = async (
          tx: Executor,
          table: string,
          column: string,
        ) =>
          (
            await tx.execute<{ data_type: string }>(sql`
              SELECT data_type FROM information_schema.columns
              WHERE table_name = ${table} AND column_name = ${column}
              LIMIT 1
            `)
          ).rows[0]?.data_type ?? null;

        try {
          await db.transaction(async (txRaw) => {
            const tx = txRaw as unknown as Executor;

            // Sanity: a healthy DB starts with the tables + indexes present.
            for (const t of ANALYTICS_TABLES) {
              expect(await tableExists(tx, t)).toBe(true);
            }
            for (const i of ANALYTICS_INDEXES) {
              expect(await indexExists(tx, i)).toBe(true);
            }

            // 1) Simulate the wipe a dev rollback / checkpoint restore causes.
            //    Drop a representative index and a representative table (the
            //    rollup, since page_views is FK-referenced by nothing here).
            //    `page_view_referrer_daily` is standalone (no FK) so it is the
            //    safest table to drop-and-restore inside the tx.
            await tx.execute(
              sql`DROP INDEX IF EXISTS page_views_viewed_at_idx`,
            );
            await tx.execute(
              sql`DROP TABLE IF EXISTS page_view_referrer_daily`,
            );
            expect(await indexExists(tx, "page_views_viewed_at_idx")).toBe(
              false,
            );
            expect(await tableExists(tx, "page_view_referrer_daily")).toBe(
              false,
            );

            // 2) Run the self-heal against the SAME transaction.
            await ensureAnalytics(silent, tx);

            // 3) Every analytics table + index is back.
            for (const t of ANALYTICS_TABLES) {
              expect(await tableExists(tx, t)).toBe(true);
            }
            for (const i of ANALYTICS_INDEXES) {
              expect(await indexExists(tx, i)).toBe(true);
            }

            // The restored tables carry the right key columns/types so the
            // dev→prod publish diff stays clean.
            expect(await columnType(tx, "page_views", "viewed_at")).toBe(
              "timestamp with time zone",
            );
            expect(await columnType(tx, "page_views", "slug")).toBe("text");
            expect(await columnType(tx, "page_view_daily", "day")).toBe("date");
            expect(await columnType(tx, "page_view_daily", "views")).toBe(
              "integer",
            );
            expect(
              await columnType(tx, "page_view_referrer_daily", "referrer_host"),
            ).toBe("text");
            expect(
              await columnType(tx, "page_view_referrer_daily", "day"),
            ).toBe("date");

            // 4) Idempotent: a second run changes nothing and does not throw.
            await ensureAnalytics(silent, tx);
            expect(await tableExists(tx, "page_view_referrer_daily")).toBe(true);
            expect(await indexExists(tx, "page_views_viewed_at_idx")).toBe(true);

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: the live schema is untouched.
        for (const t of ANALYTICS_TABLES) {
          expect(await tableExists(db, t)).toBe(true);
        }
        for (const i of ANALYTICS_INDEXES) {
          expect(await indexExists(db, i)).toBe(true);
        }
      },
      120_000,
    );
  },
);
