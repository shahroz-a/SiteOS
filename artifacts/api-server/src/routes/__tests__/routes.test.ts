process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock } from "../../__tests__/fakeDb";
import { seedTables } from "../../__tests__/fixtures";

const tables = seedTables();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

describe("GET /api/healthz", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/posts", () => {
  it("lists published posts with pagination", async () => {
    const res = await request(app).get("/api/posts");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items[0].slug).toBe("chicago-eats");
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 12,
      total: 5,
      totalPages: 1,
    });
  });

  it("honors page and limit query params", async () => {
    const res = await request(app).get("/api/posts?limit=2&page=2");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { slug: string }) => i.slug)).toEqual([
      "budget-nyc",
      "boston-for-families",
    ]);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it("filters by author, category and tag", async () => {
    const author = await request(app).get("/api/posts?author=alice-walker");
    expect(author.body.items).toHaveLength(3);

    const category = await request(app).get("/api/posts?category=travel");
    expect(category.body.items).toHaveLength(4);

    const tag = await request(app).get("/api/posts?tag=family");
    expect(tag.body.items.map((i: { slug: string }) => i.slug)).toEqual([
      "thanksgiving-recipes",
      "boston-for-families",
    ]);
  });
});

describe("GET /api/posts/:slug", () => {
  it("returns the full post detail", async () => {
    const res = await request(app).get("/api/posts/boston-for-families");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("boston-for-families");
    expect(res.body.contentHtml).toContain("turkey");
    expect(res.body.author.name).toBe("Alice Walker");
    expect(res.body.primaryCategory.slug).toBe("travel");
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toContain(
      "travel",
    );
    expect(res.body.tags.map((t: { slug: string }) => t.slug)).toEqual([
      "family",
      "thanksgiving",
    ]);
    expect(res.body.breadcrumbs).toHaveLength(2);
    expect(res.body.faq).toHaveLength(1);
    expect(res.body.images).toHaveLength(1);
    expect(res.body.jsonld).toHaveLength(1);
    expect(res.body.seo.metaTitle).toBe("Boston for Families");
  });

  it("returns 404 for an unpublished (draft) post", async () => {
    const res = await request(app).get("/api/posts/draft-post");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await request(app).get("/api/posts/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/categories", () => {
  it("lists all categories", async () => {
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns a category by slug", async () => {
    const res = await request(app).get("/api/categories/travel");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("travel");
  });

  it("returns 404 for an unknown category", async () => {
    const res = await request(app).get("/api/categories/missing");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/authors", () => {
  it("lists all authors", async () => {
    const res = await request(app).get("/api/authors");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns an author by slug", async () => {
    const res = await request(app).get("/api/authors/alice-walker");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alice Walker");
    expect(res.body.social).toEqual({ twitter: "@alice" });
  });

  it("returns 404 for an unknown author", async () => {
    const res = await request(app).get("/api/authors/missing");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/search", () => {
  it("returns posts matching the query", async () => {
    const res = await request(app).get("/api/search?q=turkey");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { slug: string }) => i.slug).sort()).toEqual([
      "boston-for-families",
      "thanksgiving-recipes",
    ]);
  });

  it("returns an empty list for a non-matching query", async () => {
    const res = await request(app).get("/api/search?q=zzz-no-match");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 for an empty q", async () => {
    const res = await request(app).get("/api/search?q=");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});

describe("invalid request handling", () => {
  it("returns 400 for an out-of-range limit", async () => {
    const res = await request(app).get("/api/posts?limit=999");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 for a non-numeric page", async () => {
    const res = await request(app).get("/api/posts?page=abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});
