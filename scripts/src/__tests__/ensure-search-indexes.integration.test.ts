/**
 * Opt-in live-DB test that proves the CMS-search self-heal
 * (`ensureSearchIndexes`) actually restores what a dev-DB rollback / checkpoint
 * restore can wipe.
 *
 * `ensure-search-indexes.ts` re-applies the `pg_trgm` extension and the 18
 * trigram GIN indexes that are NOT in any drizzle migration journal. Those
 * objects are otherwise only verified by hand, so a regression in the self-heal
 * DDL (wrong index name, wrong table/column, missing `gin_trgm_ops` opclass)
 * would go uncaught until CMS search silently broke. This test captures that
 * verification automatically.
 *
 * It runs inside a SINGLE database transaction that is ALWAYS rolled back, so the
 * live database is never mutated. Inside the tx it:
 *   1. drops a representative trigram index (the wipe a rollback would cause) and
 *      asserts it is really gone;
 *   2. runs `ensureSearchIndexes(log, tx)` against the same transaction;
 *   3. asserts the index is back as a GIN trigram index over the right column,
 *      and that every index in `TRIGRAM_INDEXES` is present.
 * The `pg_trgm` extension can't be meaningfully drop-and-restore tested inside a
 * rolled-back tx without disturbing other sessions, so it is verified for
 * presence (the self-heal `CREATE EXTENSION IF NOT EXISTS` is a no-op when it
 * already exists).
 *
 * Because it touches the real DB it only runs when `VERIFY_CMS_WRITE=1` is set;
 * the normal suite skips it. It is a no-op on a healthy DB (the function is
 * idempotent) and leaves the schema exactly as it found it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm --filter @workspace/scripts exec vitest \
 *   run src/__tests__/ensure-search-indexes.integration.test.ts`
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  ensureSearchIndexes,
  TRIGRAM_INDEXES,
  type Executor,
} from "../ensure-search-indexes";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

const silent = () => {};

// A representative trigram index to drop-and-restore. `pages_title_trgm` is a
// plain-column GIN trigram index (not an expression index) so its shape is easy
// to assert precisely.
const SAMPLE = TRIGRAM_INDEXES.find((i) => i.name === "pages_title_trgm")!;

describe.skipIf(!RUN)(
  "ensureSearchIndexes — restores what a rollback wipes (live DB, rolled back)",
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
      "re-creates the pg_trgm extension and the trigram GIN indexes",
      async () => {
        const { db } = await import("@workspace/db");

        const extensionPresent = async (tx: Executor) =>
          (
            await tx.execute(
              sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' LIMIT 1`,
            )
          ).rows.length > 0;

        const indexExists = async (tx: Executor, name: string) =>
          (
            await tx.execute(
              sql`SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = ${name} LIMIT 1`,
            )
          ).rows.length > 0;

        // Describe an index: access method + the indexed table + columns/expr.
        const indexShape = async (tx: Executor, name: string) =>
          (
            await tx.execute<{
              method: string;
              table: string;
              indexdef: string;
            }>(sql`
              SELECT am.amname AS method,
                     t.relname AS table,
                     pg_get_indexdef(i.oid) AS indexdef
              FROM pg_class i
              JOIN pg_index ix ON ix.indexrelid = i.oid
              JOIN pg_class t ON t.oid = ix.indrelid
              JOIN pg_am am ON am.oid = i.relam
              WHERE i.relname = ${name}
              LIMIT 1
            `)
          ).rows[0] ?? null;

        try {
          await db.transaction(async (txRaw) => {
            const tx = txRaw as unknown as Executor;

            // Sanity: a healthy DB starts with the extension + sample index.
            expect(await extensionPresent(tx)).toBe(true);
            expect(await indexExists(tx, SAMPLE.name)).toBe(true);

            // 1) Simulate the wipe a dev rollback / checkpoint restore causes
            //    for one representative trigram index.
            await tx.execute(sql.raw(`DROP INDEX IF EXISTS ${SAMPLE.name}`));
            expect(await indexExists(tx, SAMPLE.name)).toBe(false);

            // 2) Run the self-heal against the SAME transaction.
            await ensureSearchIndexes(silent, tx);

            // 3) The extension and every trigram index are present again.
            expect(await extensionPresent(tx)).toBe(true);
            for (const idx of TRIGRAM_INDEXES) {
              expect(await indexExists(tx, idx.name)).toBe(true);
            }

            // The restored sample index has the right shape: a GIN index over
            // the expected table, indexing the expected column with the
            // trigram opclass.
            const shape = await indexShape(tx, SAMPLE.name);
            expect(shape).not.toBeNull();
            expect(shape!.method).toBe("gin");
            expect(shape!.table).toBe(SAMPLE.table);
            expect(shape!.indexdef).toContain(SAMPLE.column);
            expect(shape!.indexdef).toContain("gin_trgm_ops");

            // 4) Idempotent: a second run changes nothing and does not throw.
            await ensureSearchIndexes(silent, tx);
            expect(await indexExists(tx, SAMPLE.name)).toBe(true);

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: the live schema is untouched.
        expect(await extensionPresent(db)).toBe(true);
        expect(await indexExists(db, SAMPLE.name)).toBe(true);
      },
      120_000,
    );
  },
);
