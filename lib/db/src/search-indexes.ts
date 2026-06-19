import { sql } from "drizzle-orm";

/**
 * The Postgres objects CMS global search (`GET /cms/search`) depends on but that
 * are NOT part of any drizzle migration journal:
 *   1. the `pg_trgm` extension (the `gin_trgm_ops` opclass + the `%` operator),
 *   2. the trigram GIN indexes listed below.
 *
 * These are declared here once and consumed by both the self-healing setup
 * script (`scripts/src/ensure-search-indexes.ts`, which CREATEs them) and the
 * api-server readiness probe (which only checks they exist). Keep this list in
 * lockstep with the `*_trgm` index declarations in the schema files
 * (`lib/db/src/schema/{pages,seo,structured,links,content,taxonomy}.ts`).
 */
export type TrigramIndex = {
  name: string;
  table: string;
  column: string;
};

export const TRIGRAM_INDEXES: ReadonlyArray<TrigramIndex> = [
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

/** Minimal executor shape satisfied by both the `db` client and a transaction. */
export interface SqlExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<{
    rows: Record<string, unknown>[];
  }>;
}

export interface SearchReadiness {
  /** Whether the `pg_trgm` extension is installed. */
  extensionPresent: boolean;
  /** Total number of trigram indexes expected to exist. */
  expectedIndexCount: number;
  /** Names of the trigram indexes that are present. */
  presentIndexes: string[];
  /** Names of the trigram indexes that are missing. */
  missingIndexes: string[];
  /** True only when the extension and every trigram index are present. */
  ready: boolean;
}

/**
 * Inspect the database for the CMS-search prerequisites without modifying
 * anything. Side-effect free and safe to call at startup or from a health
 * route. Never throws for a missing object — only a genuine DB error
 * (e.g. connection failure) propagates.
 */
export async function checkSearchReadiness(
  executor: SqlExecutor,
): Promise<SearchReadiness> {
  const extResult = await executor.execute(
    sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' LIMIT 1`,
  );
  const extensionPresent = extResult.rows.length > 0;

  const names = TRIGRAM_INDEXES.map((idx) => idx.name);
  // `= ANY(${array})` mis-binds through drizzle (Postgres 42809); use an
  // explicit IN list built from individual bound params instead.
  const idxResult = await executor.execute(
    sql`SELECT relname FROM pg_class WHERE relkind = 'i' AND relname IN (${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )})`,
  );
  const presentSet = new Set(
    idxResult.rows.map((row) => String(row["relname"])),
  );
  const presentIndexes = names.filter((n) => presentSet.has(n));
  const missingIndexes = names.filter((n) => !presentSet.has(n));

  return {
    extensionPresent,
    expectedIndexCount: names.length,
    presentIndexes,
    missingIndexes,
    ready: extensionPresent && missingIndexes.length === 0,
  };
}
