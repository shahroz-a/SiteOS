/**
 * Opt-in live-DB test that proves the publishing self-heal
 * (`ensurePublishingShapes`) actually restores everything a dev-DB rollback /
 * checkpoint restore can wipe.
 *
 * `ensure-publishing-shapes.ts` re-applies three schema shapes that are NOT in
 * any drizzle migration journal — the `page_status` enum values `review` /
 * `scheduled`, the `pages.scheduled_for` column, and its
 * `pages_scheduled_for_idx` index. The function was previously only verified by
 * hand (manually dropping the column + index and re-running it), so a regression
 * in the self-heal DDL (wrong column type, missing enum value, wrong index name)
 * would go uncaught. This test captures that verification automatically.
 *
 * It runs inside a SINGLE database transaction that is ALWAYS rolled back, so the
 * live database is never mutated. Inside the tx it:
 *   1. drops `pages_scheduled_for_idx` and the `pages.scheduled_for` column (the
 *      wipe a rollback would cause), and asserts they are really gone;
 *   2. runs `ensurePublishingShapes(log, tx)` against the same transaction;
 *   3. asserts the column is back with the right type (`timestamp with time
 *      zone`), the index is back over `scheduled_for`, and the enum carries
 *      `review` + `scheduled` (ordered before `published`).
 * Postgres enum values can't be dropped, so the enum is verified for presence +
 * ordering rather than drop-and-restore.
 *
 * Because it touches the real DB it only runs when `VERIFY_CMS_WRITE=1` is set;
 * the normal suite skips it. It is a no-op on a healthy DB (the function is
 * idempotent) and leaves the schema exactly as it found it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm --filter @workspace/scripts exec vitest \
 *   run src/__tests__/ensure-publishing-shapes.integration.test.ts`
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { ensurePublishingShapes, type Executor } from "../ensure-publishing-shapes";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

const silent = () => {};

describe.skipIf(!RUN)(
  "ensurePublishingShapes — restores what a rollback wipes (live DB, rolled back)",
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
      "re-creates pages.scheduled_for, its index, and the enum values",
      async () => {
        const { db } = await import("@workspace/db");

        const columnDef = async (tx: Executor) =>
          (
            await tx.execute<{ data_type: string }>(sql`
              SELECT data_type FROM information_schema.columns
              WHERE table_name = 'pages' AND column_name = 'scheduled_for'
              LIMIT 1
            `)
          ).rows[0]?.data_type ?? null;

        const indexCols = async (tx: Executor) =>
          (
            await tx.execute<{ col: string }>(sql`
              SELECT a.attname AS col
              FROM pg_class i
              JOIN pg_index ix ON ix.indexrelid = i.oid
              JOIN pg_class t ON t.oid = ix.indrelid
              JOIN pg_attribute a
                ON a.attrelid = t.oid AND a.attnum = ANY (ix.indkey)
              WHERE i.relname = 'pages_scheduled_for_idx'
              ORDER BY a.attnum
            `)
          ).rows.map((r) => r.col);

        // Enum labels, in their declared sort order, for `page_status`.
        const enumLabels = async (tx: Executor) =>
          (
            await tx.execute<{ enumlabel: string }>(sql`
              SELECT e.enumlabel
              FROM pg_enum e
              JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'page_status'
              ORDER BY e.enumsortorder
            `)
          ).rows.map((r) => r.enumlabel);

        try {
          await db.transaction(async (txRaw) => {
            const tx = txRaw as unknown as Executor;

            // Sanity: a healthy DB starts with the shapes present.
            expect(await columnDef(tx)).toBe("timestamp with time zone");
            expect(await indexCols(tx)).toEqual(["scheduled_for"]);

            // 1) Simulate the wipe a dev rollback / checkpoint restore causes.
            //    Drop the index first, then the column (dropping the column
            //    would drop the index anyway, but be explicit).
            await tx.execute(sql`DROP INDEX IF EXISTS pages_scheduled_for_idx`);
            await tx.execute(
              sql`ALTER TABLE pages DROP COLUMN IF EXISTS scheduled_for`,
            );
            expect(await columnDef(tx)).toBeNull();
            expect(await indexCols(tx)).toEqual([]);

            // 2) Run the self-heal against the SAME transaction.
            await ensurePublishingShapes(silent, tx);

            // 3) Everything the rollback wiped is back, with the right shape.
            expect(await columnDef(tx)).toBe("timestamp with time zone");
            expect(await indexCols(tx)).toEqual(["scheduled_for"]);

            const labels = await enumLabels(tx);
            expect(labels).toContain("review");
            expect(labels).toContain("scheduled");
            // review/scheduled must sit ahead of published (matches a fresh
            // schema create, so the dev→prod publish diff stays clean).
            expect(labels.indexOf("review")).toBeLessThan(
              labels.indexOf("published"),
            );
            expect(labels.indexOf("scheduled")).toBeLessThan(
              labels.indexOf("published"),
            );

            // 4) Idempotent: a second run changes nothing and does not throw.
            await ensurePublishingShapes(silent, tx);
            expect(await columnDef(tx)).toBe("timestamp with time zone");
            expect(await indexCols(tx)).toEqual(["scheduled_for"]);

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: the live schema is untouched.
        expect(await columnDef(db)).toBe("timestamp with time zone");
        expect(await indexCols(db)).toEqual(["scheduled_for"]);
      },
      120_000,
    );
  },
);
