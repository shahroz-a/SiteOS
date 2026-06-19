/**
 * Self-healing setup for the CMS global search prerequisites.
 *
 * CMS Search (`GET /cms/search`) relies on three Postgres objects that are NOT
 * part of any drizzle migration journal:
 *   1. the `pg_trgm` extension (provides the `gin_trgm_ops` opclass and the `%`
 *      similarity operator),
 *   2. 18 trigram GIN indexes over the searchable text columns,
 *   3. the `saved_views` table (created by `drizzle-kit push` from the schema).
 *
 * `drizzle-kit push` is broken on Helium (it silently dies during the
 * introspection step) and never creates extensions anyway, so the extension and
 * the trigram indexes were originally applied as one-off raw SQL. That means a
 * dev DB rollback / checkpoint restore — or a fresh DB — wipes them while
 * leaving the rest of the schema intact, and search stops working with no
 * obvious cause.
 *
 * This script re-creates the extension and all 18 trigram GIN indexes
 * idempotently (`CREATE EXTENSION IF NOT EXISTS` / `CREATE INDEX IF NOT
 * EXISTS`) so a rollback or fresh DB self-heals. The index definitions are kept
 * byte-for-byte in sync with the drizzle schema files
 * (`lib/db/src/schema/{pages,seo,structured,links,content,taxonomy}.ts`).
 *
 * Run with: pnpm --filter @workspace/scripts run ensure:search-indexes
 * It also runs automatically via the post-merge setup script.
 */
import { sql } from "drizzle-orm";
import { db, pool, TRIGRAM_INDEXES, type TrigramIndex } from "@workspace/db";

// The trigram-index list is the single source of truth in `@workspace/db`
// (`lib/db/src/search-indexes.ts`), so both this self-healing script and the
// api-server readiness probe stay in lockstep. Re-exported here for backward
// compatibility with importers/tests that referenced them from this script.
export { TRIGRAM_INDEXES };
export type { TrigramIndex };

/**
 * Minimal executor surface shared by the global `db` and a transaction handle.
 * Threading this through lets the self-heal run against an injected transaction
 * (e.g. a rolled-back one in tests) instead of only the global connection.
 */
export type Executor = Pick<typeof db, "execute">;

export async function ensureSearchIndexes(
  log: (m: string) => void = console.log,
  executor: Executor = db,
): Promise<void> {
  log("Ensuring pg_trgm extension exists…");
  await executor.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  log(`Ensuring ${TRIGRAM_INDEXES.length} trigram GIN indexes exist…`);
  let created = 0;
  let present = 0;
  for (const idx of TRIGRAM_INDEXES) {
    const existed = await indexExists(executor, idx.name);
    // Identifiers come from a fixed in-source list (never user input), so raw
    // interpolation is safe here and CREATE INDEX can't be parameterized.
    await executor.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} USING gin (${idx.column} gin_trgm_ops)`,
      ),
    );
    if (existed) {
      present += 1;
    } else {
      created += 1;
      log(`  + created ${idx.name}`);
    }
  }

  log(
    `Search indexes ready: ${created} created, ${present} already present (${TRIGRAM_INDEXES.length} total).`,
  );
}

async function indexExists(
  executor: Executor,
  name: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = ${name} LIMIT 1`,
  );
  return result.rows.length > 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("ensure-search-indexes.ts");

if (isMain) {
  ensureSearchIndexes()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Failed to ensure search indexes:", err);
      await pool.end();
      process.exit(1);
    });
}
