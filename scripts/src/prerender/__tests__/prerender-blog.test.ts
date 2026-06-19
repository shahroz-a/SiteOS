import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  makeDbMock,
  makeDrizzleMock,
  type FakeDbControl,
  type Tables,
} from "./fakeDb";

/**
 * Integration test for the DB-driven prerender runner (`prerender-blog.ts`). The
 * pure SEO/meta helpers are covered in `seo.test.ts`; here we exercise the
 * runner end-to-end against an in-memory fake `@workspace/db` and a temp dist
 * dir, asserting it queries posts/categories/authors, computes the right head
 * tags, writes both clean-URL file forms, skips unsafe slugs, and degrades
 * gracefully when the database is missing or errors.
 */

// A temp dist dir, created before the module is imported so `DIST_DIR`
// (computed once from `BLOG_DIST` at import time) points at it.
const DIST = mkdtempSync(path.join(os.tmpdir(), "prerender-blog-"));
process.env.BLOG_DIST = DIST;
process.env.DATABASE_URL = "postgres://fake-for-tests";

// Mutable holders installed before each test; the module reads `db` (and the
// env) at call time, not import time.
const tables: Tables = {
  pages: [],
  seo: [],
  jsonld: [],
  categories: [],
  authors: [],
  redirects: [],
};
const control: FakeDbControl = { failTables: new Set() };

vi.mock("@workspace/db", () => makeDbMock(tables, control));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { run, main } = await import("../../prerender-blog");

type Row = Record<string, unknown>;

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Headout Blog</title>
    <meta name="description" content="Default description." />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="Headout Blog" />
    <meta property="og:type" content="website" />
    <link rel="canonical" href="https://old.example.com/" />
    <script type="module" src="/blog/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

function setTables(next: Partial<Tables>) {
  for (const key of Object.keys(tables) as (keyof Tables)[]) {
    tables[key] = next[key] ?? [];
  }
}

function post(over: Row = {}): Row {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "best-beaches",
    title: "Best Beaches",
    excerpt: "Sun and sand.",
    canonicalUrl: "https://www.headout.com/blog/best-beaches/",
    featuredImageUrl: "https://cdn.example.com/beach.jpg",
    status: "published",
    pageType: "post",
    ...over,
  };
}

function seo(over: Row = {}): Row {
  return {
    pageId: "11111111-1111-1111-1111-111111111111",
    metaTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ...over,
  };
}

function jsonld(over: Row = {}): Row {
  return {
    pageId: "11111111-1111-1111-1111-111111111111",
    position: 0,
    data: { "@type": "Article", headline: "Best Beaches" },
    ...over,
  };
}

async function readDist(rel: string): Promise<string> {
  return readFile(path.join(DIST, rel), "utf8");
}

beforeEach(async () => {
  // Fresh temp dir contents + a stub built index.html for every test.
  rmSync(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await writeFile(path.join(DIST, "index.html"), TEMPLATE, "utf8");

  setTables({});
  control.failTables = new Set();
  process.env.DATABASE_URL = "postgres://fake-for-tests";
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(DIST, { recursive: true, force: true });
});

describe("run — article pages", () => {
  it("writes full article head tags (canonical/og:url/og:image/og:type/JSON-LD)", async () => {
    setTables({
      pages: [post()],
      seo: [seo()],
      jsonld: [jsonld()],
    });

    await run();

    const html = await readDist("best-beaches.html");
    expect(html).toContain("<title>Best Beaches | Headout Blog</title>");
    expect(html).toContain(
      '<meta name="description" content="Sun and sand." />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://www.headout.com/blog/best-beaches/" />',
    );
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain(
      '<meta property="og:url" content="https://www.headout.com/blog/best-beaches/" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.example.com/beach.jpg" />',
    );
    expect(html).toContain(
      '<script type="application/ld+json">{"@type":"Article","headline":"Best Beaches"}</script>',
    );
    // Stale template defaults were removed.
    expect(html).not.toContain("https://old.example.com/");
    expect(html).not.toContain('content="Default description."');
  });

  it("prefers the per-page SEO row over the page's own fields", async () => {
    setTables({
      pages: [post()],
      seo: [
        seo({
          metaTitle: "SEO Title",
          metaDescription: "SEO description.",
          canonicalUrl: "https://www.headout.com/seo/",
          ogImage: "https://cdn.example.com/og.jpg",
        }),
      ],
    });

    await run();

    const html = await readDist("best-beaches.html");
    expect(html).toContain("<title>SEO Title | Headout Blog</title>");
    expect(html).toContain(
      '<meta name="description" content="SEO description." />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://www.headout.com/seo/" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.example.com/og.jpg" />',
    );
  });

  it("orders multiple JSON-LD blocks by position", async () => {
    const pid = "22222222-2222-2222-2222-222222222222";
    setTables({
      pages: [post({ id: pid, slug: "ordered" })],
      jsonld: [
        jsonld({ pageId: pid, position: 1, data: { "@type": "Second" } }),
        jsonld({ pageId: pid, position: 0, data: { "@type": "First" } }),
      ],
    });

    await run();

    const html = await readDist("ordered.html");
    expect(html.indexOf('{"@type":"First"}')).toBeLessThan(
      html.indexOf('{"@type":"Second"}'),
    );
  });

  it("writes both <slug>.html and <slug>/index.html, byte-identical", async () => {
    setTables({ pages: [post()] });

    await run();

    const flat = await readDist("best-beaches.html");
    const nested = await readDist("best-beaches/index.html");
    expect(nested).toBe(flat);
  });

  it("skips posts with unsafe slugs", async () => {
    setTables({
      pages: [
        post({ slug: "best-beaches" }),
        post({
          id: "33333333-3333-3333-3333-333333333333",
          slug: "with/slash",
        }),
        post({
          id: "44444444-4444-4444-4444-444444444444",
          slug: "../escape",
        }),
      ],
    });

    await run();

    expect(existsSync(path.join(DIST, "best-beaches.html"))).toBe(true);
    // Unsafe slugs never reach the filesystem (no path traversal/separators).
    expect(existsSync(path.join(DIST, "with", "slash.html"))).toBe(false);
    expect(existsSync(path.join(DIST, "..", "escape.html"))).toBe(false);
    expect(existsSync(path.join(DIST, "escape.html"))).toBe(false);
  });
});

describe("run — listing pages", () => {
  it("writes index and search shells with the brand og:image but no canonical/og:url", async () => {
    await run();

    const index = await readDist("index.html");
    expect(index).toContain(
      "<title>Headout Blog — Travel inspiration &amp; destination guides</title>",
    );
    expect(index).not.toContain('rel="canonical"');
    expect(index).not.toContain("og:url");
    // Listing pages share the brand preview image so crawlers reading the
    // prerendered HTML get the same unfurl image a JS visitor's DOM gets.
    expect(index).toContain(
      '<meta property="og:image" content="/blog/og-default.png" />',
    );
    expect(index).toContain(
      '<meta name="twitter:image" content="/blog/og-default.png" />',
    );

    const search = await readDist("search.html");
    expect(search).toContain("<title>Search | Headout Blog</title>");
    expect(search).toContain(
      '<meta property="og:image" content="/blog/og-default.png" />',
    );
    expect(await readDist("search/index.html")).toBe(search);
  });

  it("writes category and author pages (both file forms) with the brand og:image but no article-only tags", async () => {
    setTables({
      categories: [
        { slug: "europe", name: "Europe", description: "Old world charm." },
      ],
      authors: [{ slug: "jane", name: "Jane Doe", bio: "Travel writer." }],
    });

    await run();

    const category = await readDist("category/europe.html");
    expect(category).toContain("<title>Europe | Headout Blog</title>");
    expect(category).toContain(
      '<meta name="description" content="Old world charm." />',
    );
    expect(category).not.toContain('rel="canonical"');
    expect(category).not.toContain("og:url");
    expect(category).not.toContain('property="og:type" content="article"');
    expect(category).toContain(
      '<meta property="og:image" content="/blog/og-default.png" />',
    );
    expect(await readDist("category/europe/index.html")).toBe(category);

    const author = await readDist("author/jane.html");
    expect(author).toContain("<title>Jane Doe | Headout Blog</title>");
    expect(author).toContain(
      '<meta name="description" content="Travel writer." />',
    );
    expect(author).toContain(
      '<meta property="og:image" content="/blog/og-default.png" />',
    );
    expect(await readDist("author/jane/index.html")).toBe(author);
  });

  it("skips categories and authors with unsafe slugs", async () => {
    setTables({
      categories: [{ slug: "../evil", name: "Evil", description: null }],
      authors: [{ slug: "a/b", name: "Bad", bio: null }],
    });

    await run();

    expect(existsSync(path.join(DIST, "category", "..", "evil.html"))).toBe(
      false,
    );
    expect(existsSync(path.join(DIST, "author", "a", "b.html"))).toBe(false);
  });

  it("throws when the built index.html is missing", async () => {
    rmSync(path.join(DIST, "index.html"), { force: true });
    await expect(run()).rejects.toThrow(/index\.html not found/);
  });
});

describe("run — redirect stubs", () => {
  it("writes forwarding stubs (both file forms) for renamed on-blog and retired off-blog URLs", async () => {
    setTables({
      redirects: [
        {
          fromPath: "/blog/vatican-city-secrets/",
          toPath: "/blog/secrets-of-the-vatican-city/",
          isActive: true,
        },
        {
          fromPath: "/blog/empire-state-building-tours/",
          toPath: "/empire-state-building-tickets-c-234/",
          isActive: true,
        },
      ],
    });

    await run();

    // Renamed on-blog article → root-relative target on the same deployment.
    const renamed = await readDist("vatican-city-secrets.html");
    expect(renamed).toContain(
      '<meta http-equiv="refresh" content="0; url=/blog/secrets-of-the-vatican-city/" />',
    );
    expect(renamed).toContain(
      '<link rel="canonical" href="/blog/secrets-of-the-vatican-city/" />',
    );
    expect(renamed).toContain('<meta name="robots" content="noindex, follow" />');
    expect(renamed).toContain(
      'location.replace("/blog/secrets-of-the-vatican-city/");',
    );
    // Both clean-URL forms, byte-identical.
    expect(await readDist("vatican-city-secrets/index.html")).toBe(renamed);

    // Retired page → absolute Headout product URL.
    const retired = await readDist("empire-state-building-tours.html");
    expect(retired).toContain(
      '<meta http-equiv="refresh" content="0; url=https://www.headout.com/empire-state-building-tickets-c-234/" />',
    );
  });

  it("never clobbers a real article file with a redirect stub", async () => {
    setTables({
      pages: [post({ slug: "best-beaches" })],
      redirects: [
        {
          fromPath: "/blog/best-beaches/",
          toPath: "/blog/somewhere-else/",
          isActive: true,
        },
      ],
    });

    await run();

    // The published article wins; no redirect refresh was written over it.
    const html = await readDist("best-beaches.html");
    expect(html).toContain("<title>Best Beaches | Headout Blog</title>");
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it("skips inactive, non-blog, and malformed redirect entries", async () => {
    setTables({
      redirects: [
        {
          fromPath: "/blog/inactive-old/",
          toPath: "/blog/new/",
          isActive: false,
        },
        {
          fromPath: "/london-theatre-tickets/the-great-gatsby-e-6581/",
          toPath: "/london-theatre-tickets/the-great-gatsby-musical-e-6581/",
          isActive: true,
        },
        {
          fromPath:
            "/blog/off-broadway-week-2-for-1/google.com/maps/place/@40.7,!4m5",
          toPath: "/blog/off-broadway-week-2-for-1/",
          isActive: true,
        },
      ],
    });

    await run();

    expect(existsSync(path.join(DIST, "inactive-old.html"))).toBe(false);
    expect(
      existsSync(
        path.join(DIST, "london-theatre-tickets", "the-great-gatsby-e-6581.html"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        path.join(DIST, "off-broadway-week-2-for-1", "google.com"),
      ),
    ).toBe(false);
  });
});

describe("main — graceful degradation", () => {
  it("warns and resolves (exit 0) when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(main()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("DATABASE_URL is not set"),
    );
    // Nothing was prerendered: the template index.html is untouched.
    expect(await readDist("index.html")).toBe(TEMPLATE);
    expect(existsSync(path.join(DIST, "search.html"))).toBe(false);
  });

  it("warns and resolves (exit 0) when a query errors mid-run", async () => {
    setTables({ pages: [post()] });
    control.failTables = new Set(["pages"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(main()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Prerender failed"),
      expect.anything(),
    );
  });

  it("still writes article tags (without structured data) when JSON-LD fails", async () => {
    setTables({
      pages: [post()],
      seo: [seo()],
      jsonld: [jsonld()],
    });
    control.failTables = new Set(["jsonld"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await main();

    const html = await readDist("best-beaches.html");
    // Core social-preview tags are present...
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.example.com/beach.jpg" />',
    );
    // ...but the structured-data block was omitted, with a single warning.
    expect(html).not.toContain('type="application/ld+json"');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("JSON-LD fetch failed"),
      expect.anything(),
    );
  });
});
