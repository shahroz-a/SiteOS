import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDbMock, makeDrizzleMock, type Tables } from "./fakeDb";
import { loadPayloadExport, type PayloadLike } from "../load.js";
import { createTestPayload, type TestPayload } from "./payloadTestConfig";

/**
 * True end-to-end smoke test: DB → `export-payload.ts` → `loadPayloadExport`
 * → real (ephemeral SQLite) Payload.
 *
 * The sibling `load.integration.test.ts` proves the loader agrees with a *real*
 * Payload schema, but it feeds the loader a hand-written fixture export. That
 * leaves a gap: a schema drift in the *actual* exporter (`buildExport`) — a new
 * field shape, a renamed relationship, a different hero-image rule — could slip
 * through unnoticed. This test closes it by running the genuine `buildExport`
 * over a seeded in-memory dataset (the same fake-`@workspace/db` pattern as
 * `export-payload.test.ts`) and loading *its exact output* into Payload.
 *
 * If the exporter and the documented loader/schema ever disagree, this fails.
 */

// Mutable holder installed before importing the module under test (it reads `db`
// at call time, not import time). `@workspace/db` is mocked; `drizzle-orm` is
// mocked so the exporter's `eq`/`asc` produce introspectable nodes the fake DB
// can evaluate. Neither mock affects Payload, which resolves its own physically
// distinct (libsql peer-variant) `drizzle-orm` copy.
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
};

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { buildExport } = await import("../../export-payload");

// A 1x1 transparent PNG so the media upload collection stores a real file
// without needing sharp or network access.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Fetch stub: every media URL resolves to the same tiny PNG. */
const fetchImpl = (async () =>
  new Response(PNG_1x1, {
    status: 200,
    headers: { "content-type": "image/png" },
  })) as unknown as typeof fetch;

// Real migration-style UUIDs so the test exercises actual id remapping.
const IDS = {
  avatar: "11111111-1111-4111-8111-111111111111",
  hero: "22222222-2222-4222-8222-222222222222",
  inline: "99999999-9999-4999-8999-999999999999",
  author: "33333333-3333-4333-8333-333333333333",
  parentCat: "44444444-4444-4444-8444-444444444444",
  childCat: "55555555-5555-4555-8555-555555555555",
  tagA: "66666666-6666-4666-8666-666666666666",
  tagB: "77777777-7777-4777-8777-777777777777",
  post: "88888888-8888-4888-8888-888888888888",
};

const AVATAR_URL = "https://cdn.example.com/avatar.jpg";
const HERO_URL = "https://cdn.example.com/hero.jpg";
const INLINE_URL = "https://cdn.example.com/inline.jpg";

/** Seed the fake migration DB with a small but relationally complete dataset. */
function seedTables(): void {
  tables.authors = [
    {
      id: IDS.author,
      name: "Aiyana Rey",
      slug: "aiyana-rey",
      bio: "Family-travel writer",
      avatarUrl: AVATAR_URL,
      role: "Senior Travel Writer",
      email: "aiyana@example.com",
      social: { twitter: "@aiyanarey" },
    },
  ];
  tables.categories = [
    {
      id: IDS.parentCat,
      name: "Travel",
      slug: "travel",
      description: "All travel",
      parentId: null,
    },
    {
      id: IDS.childCat,
      name: "Family Travel",
      slug: "family-travel",
      description: "Trips with kids",
      parentId: IDS.parentCat,
    },
  ];
  tables.tags = [
    { id: IDS.tagA, name: "Thanksgiving", slug: "thanksgiving", description: null },
    { id: IDS.tagB, name: "Kids", slug: "kids", description: null },
  ];
  tables.images = [
    // Standalone media (author avatar) — not attached to any page.
    {
      id: IDS.avatar,
      pageId: null,
      originalUrl: AVATAR_URL,
      url: AVATAR_URL,
      alt: "Author avatar",
      title: null,
      caption: null,
      credit: null,
      width: 256,
      height: 256,
      mimeType: "image/jpeg",
      fileSize: 1234,
      role: null,
      position: 0,
    },
    // Page hero (featured) + an inline image.
    {
      id: IDS.hero,
      pageId: IDS.post,
      originalUrl: HERO_URL,
      url: HERO_URL,
      alt: "Hero image",
      title: "Hero",
      caption: "On location",
      credit: "Headout",
      width: 1600,
      height: 900,
      mimeType: "image/jpeg",
      fileSize: 5678,
      role: "featured",
      position: 0,
    },
    {
      id: IDS.inline,
      pageId: IDS.post,
      originalUrl: INLINE_URL,
      url: INLINE_URL,
      alt: "Inline image",
      title: null,
      caption: null,
      credit: null,
      width: 800,
      height: 600,
      mimeType: "image/jpeg",
      fileSize: 4321,
      role: "inline",
      position: 1,
    },
  ];
  tables.pages = [
    {
      id: IDS.post,
      slug: "thanksgiving-vacation-ideas-for-families",
      title: "Thanksgiving Vacation Ideas for Families",
      subtitle: "Where to go",
      excerpt: "Twelve destinations the whole family will love.",
      status: "published",
      language: "en",
      canonicalUrl: "https://www.headout.com/blog/thanksgiving/",
      pathname: "/blog/thanksgiving/",
      parentPath: "/blog/",
      featuredImageUrl: HERO_URL,
      featuredImageAlt: "Hero image",
      cleanedHtml: "<p>Twelve destinations.</p>",
      richText: { root: { children: [] } },
      componentTree: {
        type: "root",
        schemaVersion: "1",
        children: [
          { blockType: "heading", text: "1. New York", anchorId: "nyc", data: { level: 2 } },
          { blockType: "paragraph", text: "Catch the Macy's parade." },
          {
            blockType: "list",
            data: { title: "Where to eat", ordered: false, items: ["Carbone", "Katz's"] },
          },
          {
            blockType: "section",
            data: { heading: "Attractions" },
            children: [{ blockType: "paragraph", text: "Central Park." }],
          },
          { blockType: "html", data: { html: "<table><tr><td>x</td></tr></table>" } },
        ],
      },
      readingTimeMinutes: 8,
      wordCount: 1500,
      publishedAt: new Date("2025-10-28T09:00:00.000Z"),
      modifiedAt: null,
      authorId: IDS.author,
      primaryCategoryId: IDS.parentCat,
    },
  ];
  tables.page_categories = [
    { pageId: IDS.post, categoryId: IDS.parentCat },
    { pageId: IDS.post, categoryId: IDS.childCat },
  ];
  tables.page_tags = [
    { pageId: IDS.post, tagId: IDS.tagA },
    { pageId: IDS.post, tagId: IDS.tagB },
  ];
  tables.breadcrumbs = [
    { pageId: IDS.post, label: "Home", url: "/", position: 0 },
    { pageId: IDS.post, label: "Blog", url: "/blog/", position: 1 },
  ];
  tables.faq = [
    {
      pageId: IDS.post,
      id: "faq-1",
      question: "Best time to visit?",
      answer: "Late November.",
      position: 0,
    },
  ];
  tables.jsonld = [
    { pageId: IDS.post, type: "Article", data: { "@type": "Article" }, position: 0 },
  ];
  tables.seo = [
    {
      pageId: IDS.post,
      metaTitle: "Thanksgiving Vacation Ideas",
      metaDescription: "Family destinations for Thanksgiving.",
      canonicalUrl: "https://www.headout.com/blog/thanksgiving/",
      robots: "index,follow",
      ogTitle: "Thanksgiving",
      ogDescription: "Family trips",
      ogImage: "https://cdn.example.com/og.png",
      twitterCard: "summary_large_image",
      twitterTitle: "Thanksgiving",
      twitterDescription: "Family trips",
      twitterImage: "https://cdn.example.com/og.png",
      keywords: ["thanksgiving", "family"],
    },
  ];
}

describe("export-payload.ts → real Payload load (end-to-end)", () => {
  let instance: TestPayload;
  let result: Awaited<ReturnType<typeof loadPayloadExport>>;

  beforeAll(async () => {
    seedTables();
    // The genuine exporter output — not a hand-written fixture.
    const data = await buildExport();
    instance = await createTestPayload();
    result = await loadPayloadExport(
      instance.payload as unknown as PayloadLike,
      data.collections,
      { fetchImpl },
    );
  }, 120_000);

  afterAll(async () => {
    await instance?.cleanup();
  });

  it("creates every document the exporter produced in each collection", () => {
    expect(result.counts).toEqual({
      media: 3,
      authors: 1,
      categories: 2,
      tags: 2,
      posts: 1,
    });
    // Every export UUID was remapped to a freshly generated Payload id.
    for (const uuid of Object.values(IDS)) {
      expect(result.idMap.has(uuid)).toBe(true);
    }
  });

  it("uploads media so Payload owns a real file with a stored filename", async () => {
    const mediaDocs = await instance.payload.find({
      collection: "media",
      limit: 100,
    });
    expect(mediaDocs.totalDocs).toBe(3);
    for (const m of mediaDocs.docs) {
      expect((m as { filename?: string }).filename).toBeTruthy();
    }
  });

  it("remaps the category parent relationship to the new Payload id", async () => {
    const childId = result.idMap.get(IDS.childCat)!;
    const parentId = result.idMap.get(IDS.parentCat)!;
    const child = await instance.payload.findByID({
      collection: "categories",
      id: childId,
      depth: 0,
    });
    expect((child as { parent?: unknown }).parent).toBe(parentId);
  });

  it("resolves the author avatar to the exporter-selected media doc", async () => {
    const authorId = result.idMap.get(IDS.author)!;
    const author = (await instance.payload.findByID({
      collection: "authors",
      id: authorId,
      depth: 0,
    })) as { avatar?: unknown; slug?: string };
    expect(author.slug).toBe("aiyana-rey");
    expect(author.avatar).toBe(result.idMap.get(IDS.avatar));
  });

  it("resolves author, categories, tags and heroImage on the loaded post", async () => {
    const postId = result.idMap.get(IDS.post)!;
    const post = (await instance.payload.findByID({
      collection: "posts",
      id: postId,
      depth: 2,
    })) as {
      _status?: string;
      author?: { slug?: string } | null;
      categories?: Array<{ slug?: string }>;
      tags?: Array<{ slug?: string }>;
      heroImage?: { id?: unknown; alt?: string } | null;
      layout?: Array<{ blockType?: string }>;
    };

    expect(post._status).toBe("published");
    expect(post.author?.slug).toBe("aiyana-rey");
    expect((post.categories ?? []).map((c) => c.slug).sort()).toEqual([
      "family-travel",
      "travel",
    ]);
    expect((post.tags ?? []).map((t) => t.slug).sort()).toEqual([
      "kids",
      "thanksgiving",
    ]);
    // The exporter's hero-image rule (role === "featured") chose the hero, and
    // the loader remapped it to the new media id.
    expect(post.heroImage?.id).toBe(result.idMap.get(IDS.hero));
    expect(post.heroImage?.alt).toBe("Hero image");

    // The componentTree → layout blocks survived the round-trip into Payload.
    expect((post.layout ?? []).map((b) => b.blockType)).toEqual([
      "heading",
      "paragraph",
      "list",
      "section",
      "html",
    ]);
  });

  it("carries every remaining exporter field onto the loaded post", async () => {
    const postId = result.idMap.get(IDS.post)!;
    const post = (await instance.payload.findByID({
      collection: "posts",
      id: postId,
      depth: 0,
    })) as {
      primaryCategory?: unknown;
      language?: string;
      readingTimeMinutes?: number;
      wordCount?: number;
      url?: { canonicalUrl?: string; pathname?: string; parentPath?: string };
      structuredData?: Array<{ type?: string | null; data?: unknown }>;
    };

    // primaryCategory remaps to the parent category's new Payload id.
    expect(post.primaryCategory).toBe(result.idMap.get(IDS.parentCat));
    expect(post.language).toBe("en");
    expect(post.readingTimeMinutes).toBe(8);
    expect(post.wordCount).toBe(1500);
    expect(post.url?.canonicalUrl).toBe("https://www.headout.com/blog/thanksgiving/");
    expect(post.url?.pathname).toBe("/blog/thanksgiving/");
    expect(post.url?.parentPath).toBe("/blog/");
    // The JSON-LD structured data survives the load.
    expect((post.structuredData ?? []).map((s) => s.type)).toEqual(["Article"]);
    expect((post.structuredData ?? [])[0]?.data).toEqual({ "@type": "Article" });
  });
});
