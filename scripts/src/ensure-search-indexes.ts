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
import { db, pool } from "@workspace/db";

/**
 * One entry per trigram GIN index declared in the drizzle schema. Each `column`
 * is the index *expression* exactly as Postgres stores it. Keep this list in
 * lockstep with the `*_trgm` index declarations in the schema files — there are
 * 18 of them.
 */
const TRIGRAM_INDEXES: Array<{
  name: string;
  table: string;
  column: string;
}> = [
  // lib/db/src/schema/pages.ts
  { name: "pages_title_trgm", table: "pages", column: "title" },
  { name: "pages_slug_trgm", table: "pages", column: "slug" },
  { name: "pages_canonical_url_trgm", table: "pages", column: "canonical_url" },
  { name: "pages_excerpt_trgm", table: "pages", column: "excerpt" },
  // lib/db/src/schema/seo.ts
  { name: "seo_meta_title_trgm", table: "seo", column: "meta_title" },
  {
    name: "seo_meta_description_trgm",
    table: "seo",
    column: "meta_description",
  },
  // lib/db/src/schema/structured.ts
  { name: "faq_question_trgm", table: "faq", column: "question" },
  { name: "faq_answer_trgm", table: "faq", column: "answer" },
  { name: "breadcrumbs_label_trgm", table: "breadcrumbs", column: "label" },
  // jsonld uses an expression index over the JSONB serialized as text.
  { name: "jsonld_data_trgm", table: "jsonld", column: "(data::text)" },
  // lib/db/src/schema/content.ts
  { name: "blocks_text_trgm", table: "blocks", column: "text" },
  // lib/db/src/schema/links.ts
  {
    name: "internal_links_anchor_trgm",
    table: "internal_links",
    column: "anchor_text",
  },
  { name: "internal_links_href_trgm", table: "internal_links", column: "href" },
  {
    name: "external_links_anchor_trgm",
    table: "external_links",
    column: "anchor_text",
  },
  { name: "external_links_href_trgm", table: "external_links", column: "href" },
  // lib/db/src/schema/taxonomy.ts
  { name: "authors_name_trgm", table: "authors", column: "name" },
  { name: "categories_name_trgm", table: "categories", column: "name" },
  { name: "tags_name_trgm", table: "tags", column: "name" },
];

export async function ensureSearchIndexes(
  log: (m: string) => void = console.log,
): Promise<void> {
  log("Ensuring pg_trgm extension exists…");
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  log(`Ensuring ${TRIGRAM_INDEXES.length} trigram GIN indexes exist…`);
  let created = 0;
  let present = 0;
  for (const idx of TRIGRAM_INDEXES) {
    const existed = await indexExists(idx.name);
    // Identifiers come from a fixed in-source list (never user input), so raw
    // interpolation is safe here and CREATE INDEX can't be parameterized.
    await db.execute(
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

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(
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
