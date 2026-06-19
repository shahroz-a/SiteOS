import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPayloadExport, type PayloadLike } from "../load.js";
import type { PayloadExport } from "../mapping.js";
import { createTestPayload, type TestPayload } from "./payloadTestConfig";

/**
 * Integration smoke test: loads a small fixture export into a *real* (ephemeral
 * SQLite) Payload instance using the documented loader (`../load.ts`) and
 * verifies the export actually imports cleanly — UUID→Payload-id remapping,
 * media uploads, category parent wiring, and that posts resolve their author,
 * categories, tags and heroImage after load.
 *
 * Booting Payload (schema push) takes a few seconds, so the instance is created
 * once for the whole file and given a generous timeout.
 */

// A 1x1 transparent PNG — enough for an upload collection to store a real file
// without needing sharp / network access.
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
  author: "33333333-3333-4333-8333-333333333333",
  parentCat: "44444444-4444-4444-8444-444444444444",
  childCat: "55555555-5555-4555-8555-555555555555",
  tagA: "66666666-6666-4666-8666-666666666666",
  tagB: "77777777-7777-4777-8777-777777777777",
  post: "88888888-8888-4888-8888-888888888888",
  inline: "99999999-9999-4999-8999-999999999999",
};

function fixtureExport(): PayloadExport {
  return {
    exportedAt: "2026-06-18T00:00:00.000Z",
    schemaVersion: "1",
    collections: {
      media: [
        {
          id: IDS.avatar,
          alt: "Author avatar",
          caption: null,
          credit: null,
          filename: "avatar.png",
          mimeType: "image/png",
          filesize: PNG_1x1.byteLength,
          width: 1,
          height: 1,
          sourceUrl: "https://cdn.example.com/avatar.png",
          url: "https://cdn.example.com/avatar.png",
        },
        {
          id: IDS.hero,
          alt: "Hero image",
          caption: "On location",
          credit: "Headout",
          filename: "hero.png",
          mimeType: "image/png",
          filesize: PNG_1x1.byteLength,
          width: 1,
          height: 1,
          sourceUrl: "https://cdn.example.com/hero.png",
          url: "https://cdn.example.com/hero.png",
        },
        {
          id: IDS.inline,
          alt: "Inline image",
          caption: null,
          credit: null,
          filename: "inline.png",
          mimeType: "image/png",
          filesize: PNG_1x1.byteLength,
          width: 1,
          height: 1,
          sourceUrl: "https://cdn.example.com/inline.png",
          url: "https://cdn.example.com/inline.png",
        },
      ],
      authors: [
        {
          id: IDS.author,
          name: "Aiyana Ishmael",
          slug: "aiyana-ishmael",
          bio: "Travel writer",
          role: "Contributor",
          email: "aiyana@example.com",
          avatar: IDS.avatar,
          social: { twitter: "@aiyana" },
        },
      ],
      categories: [
        {
          id: IDS.parentCat,
          title: "Travel",
          slug: "travel",
          description: "All travel",
          parent: null,
        },
        {
          id: IDS.childCat,
          title: "Family Travel",
          slug: "family-travel",
          description: "Trips with kids",
          parent: IDS.parentCat,
        },
      ],
      tags: [
        { id: IDS.tagA, title: "Thanksgiving", slug: "thanksgiving", description: null },
        { id: IDS.tagB, title: "Kids", slug: "kids", description: null },
      ],
      posts: [
        {
          id: IDS.post,
          title: "Thanksgiving Vacation Ideas for Families",
          slug: "thanksgiving-vacation-ideas-for-families",
          subtitle: "Where to go",
          excerpt: "Twelve destinations the whole family will love.",
          _status: "published",
          language: "en",
          publishedAt: "2025-10-28T09:00:00.000Z",
          author: IDS.author,
          categories: [IDS.parentCat, IDS.childCat],
          primaryCategory: IDS.parentCat,
          tags: [IDS.tagA, IDS.tagB],
          heroImage: IDS.hero,
          layout: [
            { blockType: "heading", level: 2, text: "1. New York", anchorId: "nyc" },
            { blockType: "paragraph", text: "Catch the Macy's parade." },
            {
              blockType: "list",
              ordered: false,
              title: "Where to eat",
              items: ["Carbone", "Katz's"],
            },
            {
              blockType: "section",
              heading: "Attractions",
              content: [{ blockType: "paragraph", text: "Central Park." }],
            },
            { blockType: "html", html: "<table><tr><td>x</td></tr></table>" },
          ],
          content: { root: { children: [] } },
          contentHtml: "<p>Twelve destinations.</p>",
          meta: {
            title: "Thanksgiving Vacation Ideas",
            description: "Family destinations for Thanksgiving.",
            image: "https://cdn.example.com/og.png",
            canonicalUrl: "https://www.headout.com/blog/thanksgiving/",
            robots: "index,follow",
            keywords: ["thanksgiving", "family"],
            ogTitle: "Thanksgiving",
            ogDescription: "Family trips",
            twitterCard: "summary_large_image",
          },
          url: {
            canonicalUrl: "https://www.headout.com/blog/thanksgiving/",
            pathname: "/blog/thanksgiving/",
            parentPath: "/blog/",
          },
          readingTimeMinutes: 8,
          wordCount: 1500,
          breadcrumbs: [
            { label: "Home", url: "/" },
            { label: "Blog", url: "/blog/" },
          ],
          faq: [{ question: "Best time to visit?", answer: "Late November." }],
          structuredData: [{ type: "Article", data: { "@type": "Article" } }],
          inlineImages: [
            { image: IDS.inline, role: "inline", position: 1 },
          ],
          links: {
            internal: [
              {
                href: "/blog/new-york/",
                anchorText: "New York",
                rel: null,
                position: 0,
              },
            ],
            external: [
              {
                href: "https://www.nycgo.com/",
                anchorText: "NYC Go",
                rel: "nofollow",
                domain: "www.nycgo.com",
                position: 0,
              },
            ],
          },
          metadata: {
            metaTags: [{ name: "robots", content: "index,follow" }],
            httpHeaders: { "cache-control": "max-age=3600" },
            openGraph: { "og:type": "article" },
            twitter: { "twitter:card": "summary_large_image" },
            custom: { theme: "autumn" },
          },
        },
      ],
    },
  };
}

// Booting/querying the ephemeral Payload SQLite instance can exceed the 5s
// default test timeout under load; give every test in this integration suite
// headroom via the suite-level options object.
describe("Payload export → real Payload load (integration)", { timeout: 30_000 }, () => {
  let instance: TestPayload;
  let result: Awaited<ReturnType<typeof loadPayloadExport>>;
  const data = fixtureExport();

  beforeAll(async () => {
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

  it("creates every document in each collection", () => {
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
    expect(post.author?.slug).toBe("aiyana-ishmael");
    expect((post.categories ?? []).map((c) => c.slug).sort()).toEqual([
      "family-travel",
      "travel",
    ]);
    expect((post.tags ?? []).map((t) => t.slug).sort()).toEqual([
      "kids",
      "thanksgiving",
    ]);
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

  it("is idempotent: a second load creates no duplicates", async () => {
    const collectionsToCheck = [
      "media",
      "authors",
      "categories",
      "tags",
      "posts",
    ] as const;

    // Snapshot document totals after the first (beforeAll) load.
    const before: Record<string, number> = {};
    for (const collection of collectionsToCheck) {
      before[collection] = (
        await instance.payload.find({ collection, limit: 100 })
      ).totalDocs;
    }

    // Re-run the loader against the already-populated instance.
    const second = await loadPayloadExport(
      instance.payload as unknown as PayloadLike,
      data.collections,
      { fetchImpl },
    );

    // Nothing new was created; every document was updated in place instead.
    expect(second.counts).toEqual({
      media: 0,
      authors: 0,
      categories: 0,
      tags: 0,
      posts: 0,
    });
    expect(second.updated).toEqual({
      media: 3,
      authors: 1,
      categories: 2,
      tags: 2,
      posts: 1,
    });

    // Document totals are unchanged — no duplicates were written.
    for (const collection of collectionsToCheck) {
      const after = (await instance.payload.find({ collection, limit: 100 }))
        .totalDocs;
      expect(after).toBe(before[collection]);
    }

    // The second load still resolves the same Payload ids by natural key.
    for (const uuid of Object.values(IDS)) {
      expect(second.idMap.get(uuid)).toBe(result.idMap.get(uuid));
    }
  });

  it("dry run projects the update split and writes nothing", async () => {
    const collectionsToCheck = [
      "media",
      "authors",
      "categories",
      "tags",
      "posts",
    ] as const;

    // Snapshot document totals before the dry run.
    const before: Record<string, number> = {};
    for (const collection of collectionsToCheck) {
      before[collection] = (
        await instance.payload.find({ collection, limit: 100 })
      ).totalDocs;
    }

    // The instance is already populated (from beforeAll), so a dry run should
    // project every document as an update with zero creates.
    const preview = await loadPayloadExport(
      instance.payload as unknown as PayloadLike,
      data.collections,
      { dryRun: true, fetchImpl },
    );

    expect(preview.counts).toEqual({
      media: 0,
      authors: 0,
      categories: 0,
      tags: 0,
      posts: 0,
    });
    expect(preview.updated).toEqual({
      media: 3,
      authors: 1,
      categories: 2,
      tags: 2,
      posts: 1,
    });

    // Document totals are unchanged — the dry run wrote nothing.
    for (const collection of collectionsToCheck) {
      const after = (await instance.payload.find({ collection, limit: 100 }))
        .totalDocs;
      expect(after).toBe(before[collection]);
    }

    // Existing documents are still resolved by natural key into the idMap.
    for (const uuid of Object.values(IDS)) {
      expect(preview.idMap.get(uuid)).toBe(result.idMap.get(uuid));
    }
  });

  it("carries every remaining exported field onto the loaded post", async () => {
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

  it("carries inline images, links and raw metadata onto the loaded post", async () => {
    const postId = result.idMap.get(IDS.post)!;
    const post = (await instance.payload.findByID({
      collection: "posts",
      id: postId,
      depth: 0,
    })) as {
      inlineImages?: Array<{ image?: unknown; role?: string; position?: number }>;
      links?: {
        internal?: Array<{ href?: string; anchorText?: string }>;
        external?: Array<{ href?: string; domain?: string; rel?: string }>;
      };
      metadata?: unknown;
    };

    // The inline (non-hero) image remaps to its new media id, distinct from hero.
    expect((post.inlineImages ?? []).length).toBe(1);
    expect(post.inlineImages?.[0]?.image).toBe(result.idMap.get(IDS.inline));
    expect(post.inlineImages?.[0]?.role).toBe("inline");
    expect(post.inlineImages?.[0]?.position).toBe(1);

    // Internal & external links survive verbatim.
    expect((post.links?.internal ?? []).map((l) => l.href)).toEqual([
      "/blog/new-york/",
    ]);
    expect((post.links?.external ?? []).map((l) => l.href)).toEqual([
      "https://www.nycgo.com/",
    ]);
    expect(post.links?.external?.[0]?.domain).toBe("www.nycgo.com");
    expect(post.links?.external?.[0]?.rel).toBe("nofollow");

    // The raw metadata bag is preserved as-is.
    expect(post.metadata).toEqual({
      metaTags: [{ name: "robots", content: "index,follow" }],
      httpHeaders: { "cache-control": "max-age=3600" },
      openGraph: { "og:type": "article" },
      twitter: { "twitter:card": "summary_large_image" },
      custom: { theme: "autumn" },
    });
  });
});
