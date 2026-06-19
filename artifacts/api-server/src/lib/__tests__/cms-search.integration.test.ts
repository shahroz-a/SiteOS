/**
 * Opt-in live-DB integration test for the CMS global search (`searchCmsPosts`
 * / `buildSearchPredicate`). The in-memory fake DB (`cms-search.test.ts`)
 * cannot model the raw-SQL `q` predicate (its `evalCond` treats every `sql`
 * condition as match-all) nor the `relevance` ranking expression, so those two
 * behaviours — multi-field substring matching and relevance ordering — are
 * verified here against the database configured via `DATABASE_URL`.
 *
 * It seeds a small, uniquely-tokenised corpus (one page per searchable field,
 * plus author/category/tag rows), asserts that searching each field's token
 * finds exactly the page carrying it, then proves relevance ordering ranks a
 * title hit above a body-only hit. Everything it inserts is removed in
 * `afterAll` (pages cascade to their children; taxonomy rows deleted directly).
 *
 * Search uses plain case-insensitive ILIKE substring matching — no Postgres
 * extension or special index is required, so this test needs no DB
 * prerequisites beyond the schema itself.
 *
 * Because it mutates a real database it only runs when `VERIFY_CMS_SEARCH=1`
 * is set, so the normal suite skips it.
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
const { eq, inArray } = RUN ? await import("drizzle-orm") : ({} as never);

// Per-field tokens must be unique vs the real corpus so each field's match is
// isolated. ILIKE substring matching means a token only matches a field that
// literally contains it; independent random hex strings never substring-match
// each other.
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
    // Both pages contain rankToken; one in the title (weight 4), the other
    // only in a block body (matches via EXISTS, score 0).
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
