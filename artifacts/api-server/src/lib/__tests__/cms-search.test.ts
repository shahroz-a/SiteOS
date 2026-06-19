import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";

/**
 * Unit tests for the CMS global search (`searchCmsPosts`) over the in-memory
 * fake DB. They cover the deterministic, structurally-checkable behaviour:
 * every filter (status / pageType / language / category / author / tag),
 * pagination, and the SQL-free sort modes (title / published / created /
 * updated).
 *
 * NOTE: the fuzzy multi-field `q` predicate (`buildSearchPredicate`) and the
 * `relevance` sort are raw `sql` — the fake DB cannot evaluate them (it treats
 * any raw `sql` condition as match-all). Their real behaviour (matching across
 * seo/faq/breadcrumbs/jsonld/links/blocks/author/category/tag and relevance
 * ranking) is exercised against a real Postgres in the opt-in
 * `cms-search.integration.test.ts` (gated on `VERIFY_CMS_SEARCH=1`).
 */

// Stable UUIDs (response shapes validate `id` with `.uuid()` downstream).
const ID = {
  alice: "a1a1a1a1-0000-4000-8000-000000000001",
  bob: "a1a1a1a1-0000-4000-8000-000000000002",
  travel: "c1c1c1c1-0000-4000-8000-000000000001",
  food: "c1c1c1c1-0000-4000-8000-000000000002",
  tFamily: "d1d1d1d1-0000-4000-8000-000000000001",
  tBudget: "d1d1d1d1-0000-4000-8000-000000000002",
  pub1: "00000000-0000-4000-8000-0000000000a1",
  pub2: "00000000-0000-4000-8000-0000000000a2",
  draft: "00000000-0000-4000-8000-0000000000a3",
  page: "00000000-0000-4000-8000-0000000000a4",
  arch: "00000000-0000-4000-8000-0000000000a5",
  fr: "00000000-0000-4000-8000-0000000000a6",
} as const;

function d(iso: string) {
  return new Date(iso);
}

function makePage(over: Record<string, unknown>) {
  return {
    subtitle: null,
    excerpt: null,
    canonicalUrl: `https://example.com/blog/${String(over.slug)}`,
    pathname: `/blog/${String(over.slug)}`,
    featuredImageUrl: null,
    featuredImageAlt: null,
    readingTimeMinutes: 5,
    wordCount: 800,
    language: "en",
    status: "published",
    pageType: "post",
    authorId: null,
    primaryCategoryId: null,
    publishedAt: null,
    modifiedAt: null,
    ...over,
  };
}

function seed(): Tables {
  return {
    authors: [
      {
        id: ID.alice,
        name: "Alice Walker",
        slug: "alice-walker",
        avatarUrl: null,
        role: "Editor",
      },
      {
        id: ID.bob,
        name: "Bob Stevens",
        slug: "bob-stevens",
        avatarUrl: null,
        role: null,
      },
    ],
    categories: [
      { id: ID.travel, name: "Travel", slug: "travel" },
      { id: ID.food, name: "Food", slug: "food" },
    ],
    tags: [
      { id: ID.tFamily, name: "Family", slug: "family" },
      { id: ID.tBudget, name: "Budget", slug: "budget" },
    ],
    pages: [
      makePage({
        id: ID.pub1,
        slug: "alpha-guide",
        title: "Alpha Guide",
        status: "published",
        pageType: "post",
        authorId: ID.alice,
        primaryCategoryId: ID.travel,
        publishedAt: d("2025-03-01T00:00:00Z"),
        createdAt: d("2025-01-01T00:00:00Z"),
        updatedAt: d("2025-05-01T00:00:00Z"),
      }),
      makePage({
        id: ID.pub2,
        slug: "bravo-trip",
        title: "Bravo Trip",
        status: "published",
        pageType: "post",
        authorId: ID.bob,
        primaryCategoryId: ID.food,
        publishedAt: d("2025-03-05T00:00:00Z"),
        createdAt: d("2025-01-02T00:00:00Z"),
        updatedAt: d("2025-05-03T00:00:00Z"),
      }),
      makePage({
        id: ID.draft,
        slug: "charlie-draft",
        title: "Charlie Draft",
        status: "draft",
        pageType: "post",
        authorId: ID.alice,
        primaryCategoryId: ID.travel,
        publishedAt: null,
        createdAt: d("2025-01-03T00:00:00Z"),
        updatedAt: d("2025-05-05T00:00:00Z"),
      }),
      makePage({
        id: ID.page,
        slug: "delta-page",
        title: "Delta Page",
        status: "published",
        pageType: "page",
        publishedAt: d("2025-02-01T00:00:00Z"),
        createdAt: d("2025-01-04T00:00:00Z"),
        updatedAt: d("2025-05-02T00:00:00Z"),
      }),
      makePage({
        id: ID.arch,
        slug: "echo-archived",
        title: "Echo Archived",
        status: "archived",
        pageType: "post",
        authorId: ID.bob,
        primaryCategoryId: ID.food,
        publishedAt: d("2025-02-10T00:00:00Z"),
        createdAt: d("2025-01-05T00:00:00Z"),
        updatedAt: d("2025-05-04T00:00:00Z"),
      }),
      makePage({
        id: ID.fr,
        slug: "foxtrot-fr",
        title: "Foxtrot FR",
        status: "published",
        pageType: "post",
        language: "fr",
        authorId: ID.alice,
        primaryCategoryId: ID.travel,
        publishedAt: d("2025-02-15T00:00:00Z"),
        createdAt: d("2025-01-06T00:00:00Z"),
        updatedAt: d("2025-04-01T00:00:00Z"),
      }),
    ],
    page_categories: [
      { pageId: ID.pub1, categoryId: ID.travel },
      { pageId: ID.draft, categoryId: ID.travel },
      { pageId: ID.fr, categoryId: ID.travel },
      { pageId: ID.pub2, categoryId: ID.food },
      { pageId: ID.arch, categoryId: ID.food },
    ],
    page_tags: [
      { pageId: ID.pub1, tagId: ID.tFamily },
      { pageId: ID.pub2, tagId: ID.tBudget },
    ],
  };
}

const tables: Tables = seed();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { searchCmsPosts } = await import("../posts");

beforeEach(() => {
  const fresh = seed();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
});

const slugsOf = (r: { items: { slug: string }[] }) =>
  r.items.map((i) => i.slug);

describe("searchCmsPosts — browse (no query) spans all statuses & types", () => {
  it("returns every page when no filter is applied", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50 });
    expect(res.pagination.total).toBe(6);
    expect(res.items).toHaveLength(6);
  });
});

describe("searchCmsPosts — filters", () => {
  it("filters by status (incl. drafts and archived)", async () => {
    expect(slugsOf(await searchCmsPosts({ page: 1, limit: 50, status: "draft" })))
      .toEqual(["charlie-draft"]);
    expect(
      slugsOf(await searchCmsPosts({ page: 1, limit: 50, status: "archived" })),
    ).toEqual(["echo-archived"]);
    const published = await searchCmsPosts({
      page: 1,
      limit: 50,
      status: "published",
    });
    expect(published.pagination.total).toBe(4);
    expect(slugsOf(published)).not.toContain("charlie-draft");
  });

  it("filters by pageType", async () => {
    expect(slugsOf(await searchCmsPosts({ page: 1, limit: 50, pageType: "page" })))
      .toEqual(["delta-page"]);
    const posts = await searchCmsPosts({ page: 1, limit: 50, pageType: "post" });
    expect(posts.pagination.total).toBe(5);
    expect(slugsOf(posts)).not.toContain("delta-page");
  });

  it("filters by language", async () => {
    expect(
      (await searchCmsPosts({ page: 1, limit: 50, language: "en" })).pagination
        .total,
    ).toBe(5);
    expect(slugsOf(await searchCmsPosts({ page: 1, limit: 50, language: "fr" })))
      .toEqual(["foxtrot-fr"]);
  });

  it("filters by category slug (primary + M2M links)", async () => {
    const travel = await searchCmsPosts({
      page: 1,
      limit: 50,
      categorySlug: "travel",
    });
    expect(slugsOf(travel).sort()).toEqual([
      "alpha-guide",
      "charlie-draft",
      "foxtrot-fr",
    ]);
    const food = await searchCmsPosts({
      page: 1,
      limit: 50,
      categorySlug: "food",
    });
    expect(slugsOf(food).sort()).toEqual(["bravo-trip", "echo-archived"]);
  });

  it("filters by author slug", async () => {
    expect(
      slugsOf(
        await searchCmsPosts({ page: 1, limit: 50, authorSlug: "alice-walker" }),
      ).sort(),
    ).toEqual(["alpha-guide", "charlie-draft", "foxtrot-fr"]);
    expect(
      slugsOf(
        await searchCmsPosts({ page: 1, limit: 50, authorSlug: "bob-stevens" }),
      ).sort(),
    ).toEqual(["bravo-trip", "echo-archived"]);
  });

  it("filters by tag slug", async () => {
    expect(
      slugsOf(await searchCmsPosts({ page: 1, limit: 50, tagSlugs: ["family"] })),
    ).toEqual(["alpha-guide"]);
    expect(
      slugsOf(await searchCmsPosts({ page: 1, limit: 50, tagSlugs: ["budget"] })),
    ).toEqual(["bravo-trip"]);
  });

  it("combines filters (status + author)", async () => {
    const res = await searchCmsPosts({
      page: 1,
      limit: 50,
      status: "published",
      authorSlug: "alice-walker",
    });
    // alice has alpha (published), charlie (draft), foxtrot (published) — the
    // draft is dropped by the status filter.
    expect(slugsOf(res).sort()).toEqual(["alpha-guide", "foxtrot-fr"]);
  });

  it("returns an empty list for unknown filter values", async () => {
    for (const params of [
      { authorSlug: "nobody" },
      { categorySlug: "nope" },
      { tagSlugs: ["missing"] },
    ]) {
      const res = await searchCmsPosts({ page: 1, limit: 50, ...params });
      expect(res.items).toEqual([]);
      expect(res.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1,
      });
    }
  });
});

describe("searchCmsPosts — pagination", () => {
  it("applies limit/offset and reports total + totalPages", async () => {
    const p1 = await searchCmsPosts({ page: 1, limit: 4, sort: "title" });
    expect(p1.items).toHaveLength(4);
    expect(p1.pagination).toEqual({
      page: 1,
      limit: 4,
      total: 6,
      totalPages: 2,
    });

    const p2 = await searchCmsPosts({ page: 2, limit: 4, sort: "title" });
    expect(p2.items).toHaveLength(2);
    expect(slugsOf(p2)).toEqual(["echo-archived", "foxtrot-fr"]);
  });
});

describe("searchCmsPosts — sort modes", () => {
  it("defaults to updated-desc when no query/sort is given", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50 });
    expect(slugsOf(res)).toEqual([
      "charlie-draft", // 2025-05-05
      "echo-archived", // 2025-05-04
      "bravo-trip", //    2025-05-03
      "delta-page", //    2025-05-02
      "alpha-guide", //   2025-05-01
      "foxtrot-fr", //    2025-04-01
    ]);
  });

  it("sorts by title ascending", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50, sort: "title" });
    expect(slugsOf(res)).toEqual([
      "alpha-guide",
      "bravo-trip",
      "charlie-draft",
      "delta-page",
      "echo-archived",
      "foxtrot-fr",
    ]);
  });

  it("sorts by published date (desc, nulls last)", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50, sort: "published" });
    expect(slugsOf(res)).toEqual([
      "bravo-trip", //   2025-03-05
      "alpha-guide", //  2025-03-01
      "foxtrot-fr", //   2025-02-15
      "echo-archived", //2025-02-10
      "delta-page", //   2025-02-01
      "charlie-draft", //null -> last
    ]);
  });

  it("sorts by created date (desc)", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50, sort: "created" });
    expect(slugsOf(res)).toEqual([
      "foxtrot-fr", //    2025-01-06
      "echo-archived", // 2025-01-05
      "delta-page", //    2025-01-04
      "charlie-draft", // 2025-01-03
      "bravo-trip", //    2025-01-02
      "alpha-guide", //   2025-01-01
    ]);
  });

  it("sorts by updated date (desc) when requested explicitly", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50, sort: "updated" });
    expect(slugsOf(res)).toEqual([
      "charlie-draft",
      "echo-archived",
      "bravo-trip",
      "delta-page",
      "alpha-guide",
      "foxtrot-fr",
    ]);
  });
});

describe("searchCmsPosts — result shape", () => {
  it("hydrates author, primary category and tags onto each item", async () => {
    const res = await searchCmsPosts({
      page: 1,
      limit: 50,
      tagSlugs: ["family"],
    });
    const [item] = res.items;
    expect(item.author).toMatchObject({ slug: "alice-walker", role: "Editor" });
    expect(item.primaryCategory).toMatchObject({ slug: "travel" });
    expect(item.tags.map((t) => t.slug)).toEqual(["family"]);
  });

  it("leaves author/category null and tags empty when unlinked", async () => {
    const res = await searchCmsPosts({ page: 1, limit: 50, pageType: "page" });
    const [item] = res.items;
    expect(item.author).toBeNull();
    expect(item.primaryCategory).toBeNull();
    expect(item.tags).toEqual([]);
  });
});
