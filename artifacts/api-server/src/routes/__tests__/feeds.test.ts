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

describe("GET /blog/sitemap.xml", () => {
  it("lists the blog index, published posts, categories and authors", async () => {
    const res = await request(app)
      .get("/blog/sitemap.xml")
      .set("x-forwarded-proto", "https")
      .set("x-forwarded-host", "blog.example.com");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );

    expect(res.text).toContain("<loc>https://blog.example.com/blog/</loc>");
    expect(res.text).toContain(
      "<loc>https://blog.example.com/blog/boston-for-families/</loc>",
    );
    expect(res.text).toContain(
      "<loc>https://blog.example.com/blog/category/travel</loc>",
    );
    expect(res.text).toContain(
      "<loc>https://blog.example.com/blog/author/alice-walker</loc>",
    );
    expect(res.text).toContain(
      "<lastmod>2025-11-01T00:00:00.000Z</lastmod>",
    );
  });

  it("excludes drafts and non-post pages", async () => {
    const res = await request(app).get("/blog/sitemap.xml");
    expect(res.text).not.toContain("/blog/draft-post/");
    expect(res.text).not.toContain("/blog/about/");
  });
});

describe("GET /blog/feed.xml", () => {
  it("returns an RSS feed of recent published posts", async () => {
    const res = await request(app)
      .get("/blog/feed.xml")
      .set("x-forwarded-proto", "https")
      .set("x-forwarded-host", "blog.example.com");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/rss+xml");
    expect(res.text).toContain('<rss version="2.0"');
    expect(res.text).toContain("<title>Headout Blog</title>");

    expect(res.text).toContain("<title>Chicago Eats</title>");
    expect(res.text).toContain(
      "<link>https://blog.example.com/blog/chicago-eats/</link>",
    );
    expect(res.text).toContain(
      '<guid isPermaLink="true">https://blog.example.com/blog/chicago-eats/</guid>',
    );
    expect(res.text).toContain("<dc:creator>Bob Stevens</dc:creator>");
    expect(res.text).not.toContain("Draft Post");
  });
});
