/**
 * Opt-in live-DB integration test for the CMS global search (`searchCmsPosts`
 * / `buildSearchPredicate`). The in-memory fake DB (`cms-search.test.ts`)
 * cannot model the raw-SQL `q` predicate (its `evalCond` treats every `sql`
 * condition as match-all) nor the `relevance` ranking expression, so those two
 * behaviours — multi-field fuzzy matching and relevance ordering — are verified
 * here against the database configured via `DATABASE_URL`.
 *
 * It seeds a small, uniquely-tokenised corpus (one page per searchable field,
 * plus author/category/tag rows), asserts that searching each field's token
 * finds exactly the page carrying it, then proves relevance ordering ranks a
 * title hit above a body-only hit. Everything it inserts is removed in
 * `afterAll` (pages cascade to their children; taxonomy rows deleted directly).
 *
 * Because it mutates a real database it only runs when `VERIFY_CMS_SEARCH=1`
 * is set, so the normal suite skips it. It self-provisions its prerequisites
 * (the `pg_trgm` extension + the schema's trigram GIN indexes) idempotently in
 * `beforeAll`, so it works on a freshly-provisioned database; without those
 * indexes the `%` operator is unavailable and the full-corpus scans are too slow.
 *
 * Run with: `VERIFY_CMS_SEARCH=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/cms-search.integration.test.ts`
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const RUN = process.env.VERIFY_CMS_SEARCH === "1";

const db = RUN ? (await import("@workspace/db")).db : ({} as never);
const schema = RUN ? await import("@workspace/db") : ({} as never);
const { searchCmsPosts } = RUN
  ? await import("../posts")
  : ({} as never);
const { eq, inArray, sql } = RUN ? await import("drizzle-orm") : ({} as never);

// The `q` predicate relies on `pg_trgm` + the schema's trigram GIN indexes for
// the `%` operator and acceptable latency over the full corpus. The normal app
// expects these to exist already; we ensure them here (idempotently) so the
// opt-in test is self-sufficient on a freshly-provisioned database too.
const PREREQ_DDL = [
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  "CREATE INDEX IF NOT EXISTS pages_title_trgm ON pages USING gin (title gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS pages_slug_trgm ON pages USING gin (slug gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS pages_canonical_url_trgm ON pages USING gin (canonical_url gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS pages_excerpt_trgm ON pages USING gin (excerpt gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS seo_meta_title_trgm ON seo USING gin (meta_title gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS seo_meta_description_trgm ON seo USING gin (meta_description gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS faq_question_trgm ON faq USING gin (question gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS faq_answer_trgm ON faq USING gin (answer gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS breadcrumbs_label_trgm ON breadcrumbs USING gin (label gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS jsonld_data_trgm ON jsonld USING gin (((data)::text) gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS internal_links_anchor_trgm ON internal_links USING gin (anchor_text gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS internal_links_href_trgm ON internal_links USING gin (href gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS external_links_anchor_trgm ON external_links USING gin (anchor_text gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS external_links_href_trgm ON external_links USING gin (href gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS authors_name_trgm ON authors USING gin (name gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS categories_name_trgm ON categories USING gin (name gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS tags_name_trgm ON tags USING gin (name gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS blocks_text_trgm ON blocks USING gin (text gin_trgm_ops)",
];

async function ensurePrereqs() {
  for (const stmt of PREREQ_DDL) {
    await db.execute(sql.raw(stmt));
  }
}

// Per-field tokens must be unique vs the real corpus AND mutually dissimilar:
// the `%` (pg_trgm) operator fuzzy-matches `pages.title`/`slug`, so tokens that
// shared a common prefix would cross-match each other. Independent random hex
// strings have ~zero trigram similarity, keeping each field's match isolated.
const uniq = () => `q${randomUUID().replace(/-/g, "")}`;

// A run marker just for collision-free taxonomy slugs (slugs aren't searched).
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const pageIds: string[] = [];
let authorId = "";
let categoryId = "";
let tagId = "";

/** Required NOT NULL page columns with collision-free unique values. */
function basePage(extra: Record<string, unknown> = {}) {
  const u = randomUUID();
  return {
    slug: `p-${u}`,
    title: `Page ${u}`,
    originalUrl: `https://example.test/${u}`,
    canonicalUrl: `https://example.test/${u}`,
    pathname: `/blog/${u}`,
    status: "published" as const,
    pageType: "post" as const,
    language: "en" as const,
    ...extra,
  };
}

async function insertPage(extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(schema.pagesTable)
    .values(basePage(extra))
    .returning({ id: schema.pagesTable.id });
  pageIds.push(row.id);
  return row.id;
}

// The searchable fields, each exercised by one seeded page.
const FIELDS = [
  "title",
  "slug",
  "subtitle",
  "excerpt",
  "url",
  "seo",
  "faq",
  "breadcrumb",
  "jsonld",
  "internal",
  "external",
  "block",
  "author",
  "category",
  "tag",
] as const;
type Field = (typeof FIELDS)[number];

// One mutually-dissimilar token per field, embedded in exactly that field.
const T = Object.fromEntries(FIELDS.map((f) => [f, uniq()])) as Record<
  Field,
  string
>;

// Page ids keyed by the field whose token they carry.
const ids = {} as Record<Field, string>;

beforeAll(async () => {
  if (!RUN) return;

  // Build the extension + trigram indexes on first run (no-op thereafter).
  await ensurePrereqs();

  // Taxonomy rows, each carrying a name token (slugs use RUN_ID, not searched).
  [{ id: authorId }] = await db
    .insert(schema.authorsTable)
    .values({ name: `Author ${T.author}`, slug: `a-${RUN_ID}` })
    .returning({ id: schema.authorsTable.id });
  [{ id: categoryId }] = await db
    .insert(schema.categoriesTable)
    .values({ name: `Category ${T.category}`, slug: `c-${RUN_ID}` })
    .returning({ id: schema.categoriesTable.id });
  [{ id: tagId }] = await db
    .insert(schema.tagsTable)
    .values({ name: `Tag ${T.tag}`, slug: `t-${RUN_ID}` })
    .returning({ id: schema.tagsTable.id });

  // One page per page-owned text field.
  ids.title = await insertPage({ title: `Headline ${T.title}` });
  ids.slug = await insertPage({ slug: `slug-${T.slug}` });
  ids.subtitle = await insertPage({ subtitle: `Sub ${T.subtitle}` });
  ids.excerpt = await insertPage({ excerpt: `Exc ${T.excerpt}` });
  ids.url = await insertPage({
    canonicalUrl: `https://example.test/${T.url}`,
    pathname: `/blog/${T.url}`,
  });

  // Pages whose token lives only in a related table.
  ids.seo = await insertPage();
  await db
    .insert(schema.seoTable)
    .values({ pageId: ids.seo, metaTitle: `Meta ${T.seo}` });

  ids.faq = await insertPage();
  await db
    .insert(schema.faqTable)
    .values({ pageId: ids.faq, question: `Q ${T.faq}?`, answer: "A." });

  ids.breadcrumb = await insertPage();
  await db
    .insert(schema.breadcrumbsTable)
    .values({ pageId: ids.breadcrumb, label: `Crumb ${T.breadcrumb}` });

  ids.jsonld = await insertPage();
  await db
    .insert(schema.jsonldTable)
    .values({ pageId: ids.jsonld, data: { name: `JL ${T.jsonld}` } });

  ids.internal = await insertPage();
  await db.insert(schema.internalLinksTable).values({
    pageId: ids.internal,
    href: "/blog/some-target",
    anchorText: `Anchor ${T.internal}`,
  });

  ids.external = await insertPage();
  await db.insert(schema.externalLinksTable).values({
    pageId: ids.external,
    href: `https://other.test/${T.external}`,
  });

  ids.block = await insertPage();
  await db.insert(schema.blocksTable).values({
    pageId: ids.block,
    blockType: "paragraph",
    text: `Body copy ${T.block}`,
  });

  // Pages linked to the tokenised taxonomy rows (token only in the relation).
  ids.author = await insertPage({ authorId });
  ids.category = await insertPage({ primaryCategoryId: categoryId });
  ids.tag = await insertPage();
  await db
    .insert(schema.pageTagsTable)
    .values({ pageId: ids.tag, tagId });
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  if (pageIds.length > 0) {
    await db
      .delete(schema.pagesTable)
      .where(inArray(schema.pagesTable.id, pageIds));
  }
  if (tagId)
    await db.delete(schema.tagsTable).where(eq(schema.tagsTable.id, tagId));
  if (categoryId)
    await db
      .delete(schema.categoriesTable)
      .where(eq(schema.categoriesTable.id, categoryId));
  if (authorId)
    await db
      .delete(schema.authorsTable)
      .where(eq(schema.authorsTable.id, authorId));
});

describe.skipIf(!RUN)("searchCmsPosts — live multi-field q matching", () => {
  for (const field of FIELDS) {
    it(`finds the page whose ${field} contains the query token`, async () => {
      const res = await searchCmsPosts({
        page: 1,
        limit: 50,
        q: T[field],
      });
      const found = res.items.map((i: { id: string }) => i.id);
      // Exactly the one seeded page carries this unique token.
      expect(found).toContain(ids[field]);
      expect(found).toHaveLength(1);
    });
  }

  it("returns an empty page (not an error) for a token nothing carries", async () => {
    const res = await searchCmsPosts({
      page: 1,
      limit: 50,
      q: uniq(),
    });
    expect(res.items).toEqual([]);
    expect(res.pagination.total).toBe(0);
  });
});

describe.skipIf(!RUN)("searchCmsPosts — relevance ranking", () => {
  it("ranks a title match above a body-only match", async () => {
    // Both pages contain rankToken; one in the title (weight 4 + similarity),
    // the other only in a block body (matches via EXISTS, score 0).
    const rankToken = uniq();
    const titleHit = await insertPage({ title: `Spotlight ${rankToken}` });
    const bodyHit = await insertPage();
    await db.insert(schema.blocksTable).values({
      pageId: bodyHit,
      blockType: "paragraph",
      text: `mention ${rankToken} in the body`,
    });

    const res = await searchCmsPosts({
      page: 1,
      limit: 50,
      q: rankToken,
      sort: "relevance",
    });
    const order = res.items.map((i: { id: string }) => i.id);
    expect(order).toContain(titleHit);
    expect(order).toContain(bodyHit);
    expect(order.indexOf(titleHit)).toBeLessThan(order.indexOf(bodyHit));
  });

  it("defaults to relevance ordering when q is present and no sort is given", async () => {
    const rankToken = uniq();
    const titleHit = await insertPage({ title: `Feature ${rankToken}` });
    const bodyHit = await insertPage();
    await db.insert(schema.blocksTable).values({
      pageId: bodyHit,
      blockType: "paragraph",
      text: `passing ${rankToken} reference`,
    });

    const res = await searchCmsPosts({ page: 1, limit: 50, q: rankToken });
    const order = res.items.map((i: { id: string }) => i.id);
    expect(order.indexOf(titleHit)).toBeLessThan(order.indexOf(bodyHit));
  });
});
