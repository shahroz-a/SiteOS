import { describe, it, expect, vi } from "vitest";
import { makeDbMock, makeDrizzleMock } from "../../__tests__/fakeDb";
import { seedTables, IDS } from "../../__tests__/fixtures";

const tables = seedTables();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { listPosts, buildSummaries } = await import("../posts");

const pageById = (id: string) =>
  tables.pages.find((p) => p.id === id) as never;

describe("listPosts — base listing and pagination", () => {
  it("returns only published posts, excluding drafts and non-post pages", async () => {
    const res = await listPosts({ page: 1, limit: 12 });
    expect(res.items).toHaveLength(5);
    expect(res.pagination).toEqual({
      page: 1,
      limit: 12,
      total: 5,
      totalPages: 1,
    });
    const slugs = res.items.map((i) => i.slug);
    expect(slugs).not.toContain("draft-post");
    expect(slugs).not.toContain("about");
  });

  it("excludes a non-blog page even when misclassified as a published post", async () => {
    const res = await listPosts({ page: 1, limit: 12 });
    const slugs = res.items.map((i) => i.slug);
    // The commerce fixture is pageType=post + published but its canonical URL is
    // not under /blog/, so the defensive feed filter must drop it.
    expect(slugs).not.toContain("museums-rome-sc-1002");
    expect(res.pagination.total).toBe(5);
  });

  it("orders by publishedAt desc with nulls last", async () => {
    const res = await listPosts({ page: 1, limit: 12 });
    expect(res.items.map((i) => i.slug)).toEqual([
      "chicago-eats",
      "thanksgiving-recipes",
      "budget-nyc",
      "boston-for-families",
      "seattle-getaway",
    ]);
  });

  it("paginates with limit/offset and reports totalPages", async () => {
    const p1 = await listPosts({ page: 1, limit: 2 });
    expect(p1.items.map((i) => i.slug)).toEqual([
      "chicago-eats",
      "thanksgiving-recipes",
    ]);
    expect(p1.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
    });

    const p2 = await listPosts({ page: 2, limit: 2 });
    expect(p2.items.map((i) => i.slug)).toEqual([
      "budget-nyc",
      "boston-for-families",
    ]);

    const p3 = await listPosts({ page: 3, limit: 2 });
    expect(p3.items.map((i) => i.slug)).toEqual(["seattle-getaway"]);
  });
});

describe("listPosts — filtering", () => {
  it("filters by author slug", async () => {
    const res = await listPosts({ page: 1, limit: 12, authorSlug: "alice-walker" });
    expect(res.items.map((i) => i.slug)).toEqual([
      "thanksgiving-recipes",
      "boston-for-families",
      "seattle-getaway",
    ]);
    expect(res.items.every((i) => i.author?.slug === "alice-walker")).toBe(true);
  });

  it("filters by category including M2M links and dedupes the primary category", async () => {
    const res = await listPosts({ page: 1, limit: 12, categorySlug: "travel" });
    const slugs = res.items.map((i) => i.slug);
    // chicago-eats has Food as its primary category but is linked to Travel.
    expect(slugs).toEqual([
      "chicago-eats",
      "budget-nyc",
      "boston-for-families",
      "seattle-getaway",
    ]);
    // boston-for-families is both primary + linked but must appear once.
    expect(slugs.filter((s) => s === "boston-for-families")).toHaveLength(1);
  });

  it("filters by primary category", async () => {
    const res = await listPosts({ page: 1, limit: 12, categorySlug: "food" });
    expect(res.items.map((i) => i.slug).sort()).toEqual([
      "chicago-eats",
      "thanksgiving-recipes",
    ]);
  });

  it("filters by tag slug", async () => {
    const res = await listPosts({ page: 1, limit: 12, tagSlugs: ["family"] });
    expect(res.items.map((i) => i.slug)).toEqual([
      "thanksgiving-recipes",
      "boston-for-families",
    ]);

    const budget = await listPosts({ page: 1, limit: 12, tagSlugs: ["budget"] });
    expect(budget.items.map((i) => i.slug)).toEqual(["budget-nyc"]);
  });

  it("returns an empty list for unknown filter values", async () => {
    for (const params of [
      { authorSlug: "nobody" },
      { categorySlug: "nope" },
      { tagSlugs: ["missing"] },
    ]) {
      const res = await listPosts({ page: 1, limit: 12, ...params });
      expect(res.items).toEqual([]);
      expect(res.pagination).toEqual({
        page: 1,
        limit: 12,
        total: 0,
        totalPages: 1,
      });
    }
  });
});

describe("listPosts — search", () => {
  it("matches the query against title, excerpt and cleaned HTML", async () => {
    const turkey = await listPosts({ page: 1, limit: 12, q: "turkey" });
    expect(turkey.items.map((i) => i.slug).sort()).toEqual([
      "boston-for-families",
      "thanksgiving-recipes",
    ]);

    const budget = await listPosts({ page: 1, limit: 12, q: "budget" });
    expect(budget.items.map((i) => i.slug)).toEqual(["budget-nyc"]);
  });

  it("returns nothing for a non-matching query", async () => {
    const res = await listPosts({ page: 1, limit: 12, q: "zzz-no-match" });
    expect(res.items).toEqual([]);
    expect(res.pagination.total).toBe(0);
  });
});

describe("buildSummaries — serializer", () => {
  it("maps author, primary category and tags onto a summary", async () => {
    const [summary] = await buildSummaries([pageById(IDS.p1)]);
    expect(summary).toMatchObject({
      id: IDS.p1,
      slug: "boston-for-families",
      title: "Boston for Families",
      excerpt: "A family guide to Boston.",
      author: {
        id: IDS.alice,
        name: "Alice Walker",
        slug: "alice-walker",
        role: "Editor",
      },
      primaryCategory: { id: IDS.travel, name: "Travel", slug: "travel" },
    });
    expect(summary.tags.map((t) => t.slug)).toEqual(["family", "thanksgiving"]);
  });

  it("yields null author/category and empty tags when unlinked", async () => {
    const [summary] = await buildSummaries([pageById(IDS.staticPage)]);
    expect(summary.author).toBeNull();
    expect(summary.primaryCategory).toBeNull();
    expect(summary.tags).toEqual([]);
  });

  it("returns an empty array for no input", async () => {
    expect(await buildSummaries([])).toEqual([]);
  });
});
