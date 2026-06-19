import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDbMock, makeDrizzleMock, type Tables } from "./fakeDb";

/**
 * Exercises the export *orchestration* (`buildExport`) against an in-memory fake
 * `@workspace/db`. The pure mapping layer is covered separately in
 * `mapping.test.ts`; here we verify the wiring the orchestration is responsible
 * for: hero-image selection, author-avatar lookup, collection insertion order,
 * and that every relationship id in a post points at a present document.
 */

// Mutable holder so each test can install its own dataset before importing the
// module under test (which reads `db` at call time, not import time).
const tables: Tables = {
  authors: [],
  categories: [],
  tags: [],
  pages: [],
  images: [],
  page_categories: [],
  page_tags: [],
  breadcrumbs: [],
  faq: [],
  jsonld: [],
  seo: [],
  internal_links: [],
  external_links: [],
  metadata: [],
};

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { buildExport } = await import("../../export-payload");

type Row = Record<string, unknown>;

function setTables(next: Partial<Tables>) {
  for (const key of Object.keys(tables) as (keyof Tables)[]) {
    tables[key] = next[key] ?? [];
  }
}

function author(over: Row = {}): Row {
  return {
    id: "author-1",
    name: "Ada Lovelace",
    slug: "ada-lovelace",
    bio: "Writer",
    avatarUrl: null,
    role: "Editor",
    email: "ada@example.com",
    social: null,
    ...over,
  };
}

function category(over: Row = {}): Row {
  return {
    id: "cat-travel",
    name: "Travel",
    slug: "travel",
    description: null,
    parentId: null,
    ...over,
  };
}

function tag(over: Row = {}): Row {
  return {
    id: "tag-family",
    name: "Family",
    slug: "family",
    description: null,
    ...over,
  };
}

function image(over: Row = {}): Row {
  return {
    id: "img-1",
    pageId: "page-1",
    originalUrl: "https://cdn.example.com/img-1.jpg",
    url: "https://cdn.example.com/img-1.jpg",
    alt: "An image",
    title: null,
    caption: null,
    credit: null,
    width: 800,
    height: 600,
    mimeType: "image/jpeg",
    fileSize: 1234,
    role: null,
    position: 0,
    ...over,
  };
}

function page(over: Row = {}): Row {
  return {
    id: "page-1",
    slug: "a-post",
    title: "A Post",
    subtitle: null,
    excerpt: null,
    status: "published",
    language: "en",
    canonicalUrl: "https://www.headout.com/blog/a-post/",
    pathname: "/blog/a-post/",
    parentPath: "/blog/",
    featuredImageUrl: null,
    featuredImageAlt: null,
    cleanedHtml: "<p>hi</p>",
    richText: null,
    componentTree: null,
    readingTimeMinutes: 3,
    wordCount: 100,
    publishedAt: new Date("2024-01-01T00:00:00Z"),
    modifiedAt: null,
    authorId: "author-1",
    primaryCategoryId: "cat-travel",
    ...over,
  };
}

describe("buildExport — media collection & ordering", () => {
  beforeEach(() => setTables({}));

  it("emits one media document per image, ordered by position", async () => {
    setTables({
      images: [
        image({ id: "img-c", position: 2, url: "https://cdn.example.com/c.jpg" }),
        image({ id: "img-a", position: 0, url: "https://cdn.example.com/a.jpg" }),
        image({ id: "img-b", position: 1, url: "https://cdn.example.com/b.jpg" }),
      ],
    });

    const out = await buildExport();
    expect(out.collections.media.map((m) => m.id)).toEqual([
      "img-a",
      "img-b",
      "img-c",
    ]);
    // Media carries the image's own data, not some other doc's.
    expect(out.collections.media[0]!.url).toBe("https://cdn.example.com/a.jpg");
  });
});

describe("buildExport — author avatar resolution", () => {
  beforeEach(() => setTables({}));

  it("resolves an avatar URL to the matching media document id", async () => {
    setTables({
      authors: [
        author({ id: "a-1", avatarUrl: "https://cdn.example.com/face.jpg" }),
      ],
      images: [
        image({ id: "media-face", pageId: null, url: "https://cdn.example.com/face.jpg" }),
        image({ id: "media-other", pageId: null, url: "https://cdn.example.com/x.jpg" }),
      ],
    });

    const out = await buildExport();
    const a = out.collections.authors.find((x) => x.id === "a-1")!;
    expect(a.avatar).toBe("media-face");
  });

  it("leaves avatar null when the author has no avatar URL", async () => {
    setTables({ authors: [author({ id: "a-1", avatarUrl: null })] });
    const out = await buildExport();
    expect(out.collections.authors[0]!.avatar).toBeNull();
  });

  it("leaves avatar null when no media matches the avatar URL", async () => {
    setTables({
      authors: [author({ id: "a-1", avatarUrl: "https://cdn.example.com/missing.jpg" })],
      images: [image({ id: "media-other", pageId: null, url: "https://cdn.example.com/x.jpg" })],
    });
    const out = await buildExport();
    expect(out.collections.authors[0]!.avatar).toBeNull();
  });
});

describe("buildExport — hero image selection", () => {
  beforeEach(() => setTables({}));

  it("prefers an image with role 'featured'", async () => {
    setTables({
      pages: [page({ id: "p1", featuredImageUrl: "https://cdn.example.com/by-url.jpg" })],
      images: [
        image({ id: "img-first", pageId: "p1", position: 0 }),
        image({ id: "img-byurl", pageId: "p1", position: 1, url: "https://cdn.example.com/by-url.jpg" }),
        image({ id: "img-featured", pageId: "p1", position: 2, role: "featured" }),
      ],
    });

    const out = await buildExport();
    expect(out.collections.posts[0]!.heroImage).toBe("img-featured");
  });

  it("falls back to the image matching page.featuredImageUrl", async () => {
    setTables({
      pages: [page({ id: "p1", featuredImageUrl: "https://cdn.example.com/by-url.jpg" })],
      images: [
        image({ id: "img-first", pageId: "p1", position: 0 }),
        image({ id: "img-byurl", pageId: "p1", position: 1, url: "https://cdn.example.com/by-url.jpg" }),
      ],
    });

    const out = await buildExport();
    expect(out.collections.posts[0]!.heroImage).toBe("img-byurl");
  });

  it("falls back to the first image (by position) when nothing else matches", async () => {
    setTables({
      pages: [page({ id: "p1", featuredImageUrl: null })],
      images: [
        image({ id: "img-second", pageId: "p1", position: 1 }),
        image({ id: "img-first", pageId: "p1", position: 0 }),
      ],
    });

    const out = await buildExport();
    expect(out.collections.posts[0]!.heroImage).toBe("img-first");
  });

  it("leaves heroImage null when the page has no images", async () => {
    setTables({ pages: [page({ id: "p1" })], images: [] });
    const out = await buildExport();
    expect(out.collections.posts[0]!.heroImage).toBeNull();
  });
});

describe("buildExport — collection insertion order", () => {
  beforeEach(() => setTables({}));

  it("orders the top-level collections media → authors → categories → tags → posts", async () => {
    setTables({
      authors: [author()],
      categories: [category()],
      tags: [tag()],
      pages: [page()],
      images: [image()],
    });

    const out = await buildExport();
    expect(Object.keys(out.collections)).toEqual([
      "media",
      "authors",
      "categories",
      "tags",
      "posts",
    ]);
  });

  it("orders posts by publishedAt ascending (nulls last)", async () => {
    setTables({
      pages: [
        page({ id: "p-newer", slug: "newer", canonicalUrl: "https://h/newer", publishedAt: new Date("2024-06-01T00:00:00Z") }),
        page({ id: "p-null", slug: "nulldate", canonicalUrl: "https://h/null", publishedAt: null }),
        page({ id: "p-older", slug: "older", canonicalUrl: "https://h/older", publishedAt: new Date("2024-01-01T00:00:00Z") }),
      ],
    });

    const out = await buildExport();
    expect(out.collections.posts.map((p) => p.slug)).toEqual([
      "older",
      "newer",
      "nulldate",
    ]);
  });
});

describe("buildExport — relationship integrity", () => {
  beforeEach(() => setTables({}));

  it("wires post relationships to ids that are present in their collections", async () => {
    setTables({
      authors: [author({ id: "a-1", avatarUrl: "https://cdn.example.com/face.jpg" })],
      categories: [
        category({ id: "c-travel", slug: "travel" }),
        category({ id: "c-food", slug: "food" }),
      ],
      tags: [
        tag({ id: "t-family", slug: "family" }),
        tag({ id: "t-budget", slug: "budget" }),
      ],
      pages: [
        page({ id: "p1", authorId: "a-1", primaryCategoryId: "c-travel" }),
      ],
      images: [
        image({ id: "media-face", pageId: null, url: "https://cdn.example.com/face.jpg" }),
        image({ id: "media-hero", pageId: "p1", role: "featured", url: "https://cdn.example.com/hero.jpg" }),
      ],
      page_categories: [
        { pageId: "p1", categoryId: "c-travel" },
        { pageId: "p1", categoryId: "c-food" },
      ],
      page_tags: [
        { pageId: "p1", tagId: "t-family" },
        { pageId: "p1", tagId: "t-budget" },
      ],
    });

    const out = await buildExport();
    const post = out.collections.posts[0]!;

    const authorIds = new Set(out.collections.authors.map((a) => a.id));
    const categoryIds = new Set(out.collections.categories.map((c) => c.id));
    const tagIds = new Set(out.collections.tags.map((t) => t.id));
    const mediaIds = new Set(out.collections.media.map((m) => m.id));

    expect(authorIds.has(post.author!)).toBe(true);
    expect(categoryIds.has(post.primaryCategory!)).toBe(true);
    expect(post.categories.every((id) => categoryIds.has(id))).toBe(true);
    expect(post.categories).toEqual(["c-travel", "c-food"]);
    expect(post.tags.every((id) => tagIds.has(id))).toBe(true);
    expect(post.tags).toEqual(["t-family", "t-budget"]);
    expect(mediaIds.has(post.heroImage!)).toBe(true);
    expect(post.heroImage).toBe("media-hero");

    // Author avatar also points at a present media document.
    const author1 = out.collections.authors.find((a) => a.id === "a-1")!;
    expect(mediaIds.has(author1.avatar!)).toBe(true);
  });

  it("assembles per-page breadcrumbs, faq, structured data and seo meta", async () => {
    setTables({
      pages: [page({ id: "p1" })],
      breadcrumbs: [
        { pageId: "p1", label: "Home", url: "/", position: 0 },
        { pageId: "p1", label: "Blog", url: "/blog/", position: 1 },
      ],
      faq: [
        { pageId: "p1", id: "f1", question: "Q1?", answer: "A1", position: 0 },
      ],
      jsonld: [
        { pageId: "p1", type: "Article", data: { "@type": "Article" }, position: 0 },
      ],
      seo: [
        {
          pageId: "p1",
          metaTitle: "Meta Title",
          metaDescription: "Meta Desc",
          canonicalUrl: null,
          robots: "index,follow",
          ogTitle: null,
          ogDescription: null,
          ogImage: "https://cdn.example.com/og.jpg",
          twitterCard: null,
          twitterTitle: null,
          twitterDescription: null,
          twitterImage: null,
          keywords: ["a", "b"],
        },
      ],
    });

    const out = await buildExport();
    const post = out.collections.posts[0]!;
    expect(post.breadcrumbs).toEqual([
      { label: "Home", url: "/" },
      { label: "Blog", url: "/blog/" },
    ]);
    expect(post.faq).toEqual([{ question: "Q1?", answer: "A1" }]);
    expect(post.structuredData).toEqual([
      { type: "Article", data: { "@type": "Article" } },
    ]);
    expect(post.meta.title).toBe("Meta Title");
    expect(post.meta.image).toBe("https://cdn.example.com/og.jpg");
    expect(post.meta.keywords).toEqual(["a", "b"]);
  });

  it("scopes per-page relations so one page's links never leak into another", async () => {
    setTables({
      categories: [category({ id: "c-1", slug: "one" }), category({ id: "c-2", slug: "two" })],
      pages: [
        page({ id: "p1", slug: "first", canonicalUrl: "https://h/first", primaryCategoryId: "c-1", publishedAt: new Date("2024-01-01T00:00:00Z") }),
        page({ id: "p2", slug: "second", canonicalUrl: "https://h/second", primaryCategoryId: "c-2", publishedAt: new Date("2024-02-01T00:00:00Z") }),
      ],
      page_categories: [
        { pageId: "p1", categoryId: "c-1" },
        { pageId: "p2", categoryId: "c-2" },
      ],
    });

    const out = await buildExport();
    const [first, second] = out.collections.posts;
    expect(first!.categories).toEqual(["c-1"]);
    expect(second!.categories).toEqual(["c-2"]);
  });
});
