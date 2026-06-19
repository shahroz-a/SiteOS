import { describe, it, expect } from "vitest";
import {
  serializeBundle,
  parseBundle,
  serializeCsv,
  parseCsv,
  serializeMarkdown,
  parseMarkdown,
  serializeSql,
  bundleToPayloadManifest,
  payloadManifestToBundle,
  withCounts,
  type ContentBundle,
} from "./index.js";

function sampleBundle(): ContentBundle {
  return withCounts({
    bundleVersion: "1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    source: "test",
    authors: [
      {
        name: "Ada Lovelace",
        slug: "ada",
        bio: "Pioneer",
        avatarUrl: "https://cdn/x.jpg",
        role: "Writer",
        email: "ada@example.com",
        social: { x: "@ada" },
      },
    ],
    categories: [
      { name: "Travel", slug: "travel", description: "Trips", parentSlug: null },
      { name: "Europe", slug: "europe", description: null, parentSlug: "travel" },
    ],
    tags: [{ name: "Tips", slug: "tips", description: null }],
    posts: [
      {
        slug: "hello-world",
        title: 'Hello, "World"',
        subtitle: "A subtitle",
        excerpt: "Line one\nLine two, with comma",
        status: "published",
        language: "en",
        canonicalUrl: "https://blog/hello-world",
        originalUrl: "https://blog/hello-world",
        pathname: "/hello-world",
        parentPath: "/",
        authorSlug: "ada",
        primaryCategorySlug: "travel",
        categorySlugs: ["travel", "europe"],
        tagSlugs: ["tips"],
        featuredImageUrl: "https://cdn/hero.jpg",
        featuredImageAlt: "Hero",
        contentHtml: "<p>Hello <strong>world</strong></p>",
        richText: { type: "root", children: [] },
        componentTree: {
          type: "root",
          children: [{ blockType: "paragraph", text: "Hello world" }],
        },
        readingTimeMinutes: 3,
        wordCount: 120,
        publishedAt: "2025-12-01T00:00:00.000Z",
        modifiedAt: "2025-12-02T00:00:00.000Z",
        seo: {
          metaTitle: "Hello",
          metaDescription: "Desc",
          canonicalUrl: "https://blog/hello-world",
          robots: "index,follow",
          focusKeyword: "hello",
          keywords: ["a", "b"],
          ogTitle: "OG",
          ogDescription: null,
          ogImage: null,
          ogType: "article",
          twitterCard: "summary",
          twitterTitle: null,
          twitterDescription: null,
          twitterImage: null,
        },
        breadcrumbs: [{ label: "Home", url: "/", position: 0 }],
        faq: [{ question: "Q?", answer: "A.", position: 0 }],
        jsonld: [{ type: "Article", data: { "@type": "Article" }, position: 0 }],
        images: [
          {
            originalUrl: "https://cdn/hero.jpg",
            url: "https://cdn/hero.jpg",
            alt: "Hero",
            title: null,
            caption: null,
            credit: null,
            width: 1200,
            height: 630,
            mimeType: "image/jpeg",
            fileSize: 4242,
            role: "featured",
            position: 0,
          },
          {
            originalUrl: "https://cdn/inline.jpg",
            url: "https://cdn/inline.jpg",
            alt: "Inline",
            title: null,
            caption: "cap",
            credit: null,
            width: 800,
            height: 600,
            mimeType: "image/jpeg",
            fileSize: 1000,
            role: "inline",
            position: 1,
          },
        ],
        links: {
          internal: [
            { href: "https://blog/other", anchorText: "Other", rel: null, position: 0 },
          ],
          external: [
            {
              href: "https://ext.com",
              anchorText: "Ext",
              rel: "nofollow",
              domain: "ext.com",
              position: 0,
            },
          ],
        },
        metadata: {
          metaTags: [{ name: "x", content: "y" }],
          httpHeaders: { "x-test": "1" },
          openGraph: { a: 1 },
          twitter: null,
          custom: null,
        },
      },
    ],
  });
}

describe("JSON round-trip", () => {
  it("is fully lossless", () => {
    const bundle = sampleBundle();
    const json = serializeBundle(bundle, "json");
    const back = parseBundle(json, "json");
    expect(back).toEqual(bundle);
  });
});

describe("CSV round-trip", () => {
  it("preserves scalar post fields and escapes special characters", () => {
    const bundle = sampleBundle();
    const csv = serializeCsv(bundle);
    expect(csv.split("\r\n")[0]).toContain("slug,title");
    const back = parseCsv(csv);
    const p = back.posts[0]!;
    expect(p.slug).toBe("hello-world");
    expect(p.title).toBe('Hello, "World"');
    expect(p.excerpt).toBe("Line one\nLine two, with comma");
    expect(p.categorySlugs).toEqual(["travel", "europe"]);
    expect(p.tagSlugs).toEqual(["tips"]);
    expect(p.contentHtml).toBe("<p>Hello <strong>world</strong></p>");
    expect(p.readingTimeMinutes).toBe(3);
  });
});

describe("Markdown round-trip", () => {
  it("preserves front-matter and HTML body", () => {
    const bundle = sampleBundle();
    const md = serializeMarkdown(bundle);
    const back = parseMarkdown(md);
    const p = back.posts[0]!;
    expect(p.slug).toBe("hello-world");
    expect(p.title).toBe('Hello, "World"');
    expect(p.categorySlugs).toEqual(["travel", "europe"]);
    expect(p.contentHtml).toBe("<p>Hello <strong>world</strong></p>");
    expect(p.canonicalUrl).toBe("https://blog/hello-world");
  });
});

describe("SQL export", () => {
  it("emits a transactional, idempotent dump", () => {
    const sql = serializeSql(sampleBundle());
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
    expect(sql).toContain("INSERT INTO authors");
    expect(sql).toContain("INSERT INTO pages");
    expect(sql).toContain("ON CONFLICT (canonical_url) DO NOTHING");
    // Same input → same output (deterministic ids).
    expect(serializeSql(sampleBundle())).toBe(sql);
  });
});

describe("Payload manifest round-trip", () => {
  it("maps to collections and back without losing core content", () => {
    const bundle = sampleBundle();
    const manifest = bundleToPayloadManifest(bundle);
    expect(manifest.collections.posts).toHaveLength(1);
    expect(manifest.collections.media.length).toBeGreaterThanOrEqual(2);
    const back = payloadManifestToBundle(manifest);
    const p = back.posts[0]!;
    expect(p.slug).toBe("hello-world");
    expect(p.authorSlug).toBe("ada");
    expect(p.primaryCategorySlug).toBe("travel");
    expect(p.categorySlugs).toEqual(["travel", "europe"]);
    expect(p.tagSlugs).toEqual(["tips"]);
    expect(p.images).toHaveLength(2);
    expect(p.faq).toEqual(bundle.posts[0]!.faq);
    expect(p.links).toEqual(bundle.posts[0]!.links);
    expect(back.categories.find((c) => c.slug === "europe")?.parentSlug).toBe(
      "travel",
    );
  });

  it("parses a manifest provided as a JSON string via parseBundle", () => {
    const manifest = bundleToPayloadManifest(sampleBundle());
    const back = parseBundle(JSON.stringify(manifest), "payload");
    expect(back.posts[0]!.slug).toBe("hello-world");
  });
});
