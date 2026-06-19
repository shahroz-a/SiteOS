import { describe, expect, it } from "vitest";
import {
  componentTreeToLayout,
  mapAuthor,
  mapCategory,
  mapImage,
  mapPost,
  mapTag,
  type PayloadBlock,
  type SourceAuthor,
  type SourceCategory,
  type SourceImage,
  type SourcePage,
  type SourcePageBundle,
  type SourceTag,
} from "../mapping";

// ---------------------------------------------------------------------------
// componentTreeToLayout
// ---------------------------------------------------------------------------

describe("componentTreeToLayout", () => {
  it("returns an empty array for null/undefined/empty trees", () => {
    expect(componentTreeToLayout(null)).toEqual([]);
    expect(componentTreeToLayout(undefined)).toEqual([]);
    expect(componentTreeToLayout("")).toEqual([]);
    expect(componentTreeToLayout(0)).toEqual([]);
  });

  it("maps a bare array of nodes", () => {
    const tree = [
      { blockType: "heading", text: "Title", data: { level: 2 } },
      { blockType: "paragraph", text: "Hello world" },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "heading", level: 2, text: "Title" },
      { blockType: "paragraph", text: "Hello world" },
    ]);
  });

  it("maps a `{ children: [...] }` tree shape", () => {
    const tree = {
      children: [{ blockType: "paragraph", text: "Body" }],
    };
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "Body" },
    ]);
  });

  it("maps a `{ root: { children: [...] } }` tree shape", () => {
    const tree = {
      root: { children: [{ blockType: "paragraph", text: "Rooted" }] },
    };
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "Rooted" },
    ]);
  });

  it("prefers `children` over `root.children` when both exist", () => {
    const tree = {
      children: [{ blockType: "paragraph", text: "Top-level" }],
      root: { children: [{ blockType: "paragraph", text: "Nested root" }] },
    };
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "Top-level" },
    ]);
  });

  it("returns an empty array for objects without a recognized children key", () => {
    expect(componentTreeToLayout({ foo: "bar" })).toEqual([]);
    expect(componentTreeToLayout({ children: "not-an-array" })).toEqual([]);
    expect(componentTreeToLayout({ root: { children: "nope" } })).toEqual([]);
  });

  it("derives heading level from data.level, data.tag (h-prefixed), and clamps it", () => {
    const tree = [
      { blockType: "heading", text: "Numeric", data: { level: 3 } },
      { blockType: "heading", text: "Tag", data: { tag: "h4" } },
      { blockType: "heading", text: "Bare number string", data: { level: "5" } },
      { blockType: "heading", text: "Too big", data: { level: 99 } },
      { blockType: "heading", text: "Too small", data: { level: 0 } },
      { blockType: "heading", text: "Default" },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "heading", level: 3, text: "Numeric" },
      { blockType: "heading", level: 4, text: "Tag" },
      { blockType: "heading", level: 5, text: "Bare number string" },
      { blockType: "heading", level: 6, text: "Too big" },
      { blockType: "heading", level: 1, text: "Too small" },
      { blockType: "heading", level: 2, text: "Default" },
    ]);
  });

  it("reads heading/paragraph text from node.text or data.text", () => {
    const tree = [
      { blockType: "heading", data: { text: "From data", level: 2 } },
      { blockType: "paragraph", data: { text: "Para from data" } },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "heading", level: 2, text: "From data" },
      { blockType: "paragraph", text: "Para from data" },
    ]);
  });

  it("carries anchorId through headings and sections", () => {
    const tree = [
      { blockType: "heading", text: "Anchored", anchorId: "h-1", data: { level: 2 } },
      {
        blockType: "section",
        anchorId: "sec-1",
        data: { heading: "Section A" },
        children: [{ blockType: "paragraph", text: "Inside" }],
      },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "heading", level: 2, text: "Anchored", anchorId: "h-1" },
      {
        blockType: "section",
        heading: "Section A",
        anchorId: "sec-1",
        content: [{ blockType: "paragraph", text: "Inside" }],
      },
    ]);
  });

  it("maps ordered and unordered lists, filtering non-string items and including an optional title", () => {
    const tree = [
      {
        blockType: "list",
        data: { ordered: true, title: "Steps", items: ["a", 2, "b", null, "c"] },
      },
      { blockType: "list", data: { items: ["x", "y"] } },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "list", ordered: true, items: ["a", "b", "c"], title: "Steps" },
      { blockType: "list", ordered: false, items: ["x", "y"] },
    ]);
  });

  it("defaults list items to an empty array when data.items is missing or not an array", () => {
    const tree = [
      { blockType: "list", data: {} },
      { blockType: "list", data: { items: "nope" } },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "list", ordered: false, items: [] },
      { blockType: "list", ordered: false, items: [] },
    ]);
  });

  it("maps html blocks from data.html, falling back to node.text", () => {
    const tree = [
      { blockType: "html", data: { html: "<p>raw</p>" } },
      { blockType: "html", text: "<div>from text</div>" },
      { blockType: "html" },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "html", html: "<p>raw</p>" },
      { blockType: "html", html: "<div>from text</div>" },
      { blockType: "html", html: "" },
    ]);
  });

  it("recursively maps nested sections", () => {
    const tree = [
      {
        blockType: "section",
        data: { heading: "Outer" },
        children: [
          { blockType: "paragraph", text: "outer para" },
          {
            blockType: "section",
            data: { heading: "Inner" },
            children: [{ blockType: "heading", text: "Deep", data: { level: 3 } }],
          },
        ],
      },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      {
        blockType: "section",
        heading: "Outer",
        content: [
          { blockType: "paragraph", text: "outer para" },
          {
            blockType: "section",
            heading: "Inner",
            content: [{ blockType: "heading", level: 3, text: "Deep" }],
          },
        ],
      },
    ]);
  });

  it("produces an empty section content array when a section has no children", () => {
    const tree = [{ blockType: "section", data: { heading: "Empty" } }];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "section", heading: "Empty", content: [] },
    ]);
  });

  it("falls back to a paragraph for unknown block types that carry text", () => {
    const tree = [
      { blockType: "quote", text: "Mystery text" },
      { blockType: "whatever", text: "Also kept" },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "Mystery text" },
      { blockType: "paragraph", text: "Also kept" },
    ]);
  });

  it("drops unknown/typeless blocks that carry no text", () => {
    const tree = [
      { blockType: "spacer" },
      { blockType: "image", data: { src: "x.png" } },
      {},
      { blockType: "paragraph", text: "kept" },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "kept" },
    ]);
  });

  it("treats a typeless node that carries text as a paragraph", () => {
    const tree = [{ text: "no blockType" }];
    expect(componentTreeToLayout(tree)).toEqual([
      { blockType: "paragraph", text: "no blockType" },
    ]);
  });

  it("nests unknown-but-text blocks correctly inside sections", () => {
    const tree = [
      {
        blockType: "section",
        children: [
          { blockType: "callout", text: "noticed" },
          { blockType: "spacer" },
        ],
      },
    ];
    expect(componentTreeToLayout(tree)).toEqual([
      {
        blockType: "section",
        content: [{ blockType: "paragraph", text: "noticed" }],
      } satisfies PayloadBlock,
    ]);
  });
});

// ---------------------------------------------------------------------------
// mapAuthor
// ---------------------------------------------------------------------------

describe("mapAuthor", () => {
  const author: SourceAuthor = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Jane Doe",
    slug: "jane-doe",
    bio: "Writer",
    avatarUrl: "https://cdn.example.com/jane.jpg",
    role: "Editor",
    email: "jane@example.com",
    social: { twitter: "@jane" },
  };

  it("maps fields and uses the resolved avatar media id as a relationship", () => {
    const doc = mapAuthor(author, "avatar-media-id");
    expect(doc).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Jane Doe",
      slug: "jane-doe",
      bio: "Writer",
      role: "Editor",
      email: "jane@example.com",
      avatar: "avatar-media-id",
      social: { twitter: "@jane" },
    });
  });

  it("sets avatar to null when no media id is resolved", () => {
    expect(mapAuthor(author, null).avatar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapCategory
// ---------------------------------------------------------------------------

describe("mapCategory", () => {
  it("maps name->title and parentId->parent relationship", () => {
    const category: SourceCategory = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Travel",
      slug: "travel",
      description: "Trips",
      parentId: "33333333-3333-3333-3333-333333333333",
    };
    expect(mapCategory(category)).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      title: "Travel",
      slug: "travel",
      description: "Trips",
      parent: "33333333-3333-3333-3333-333333333333",
    });
  });

  it("keeps a null parent when the category is top-level", () => {
    const category: SourceCategory = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Travel",
      slug: "travel",
      description: null,
      parentId: null,
    };
    expect(mapCategory(category).parent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapTag
// ---------------------------------------------------------------------------

describe("mapTag", () => {
  it("maps name->title", () => {
    const tag: SourceTag = {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Family",
      slug: "family",
      description: null,
    };
    expect(mapTag(tag)).toEqual({
      id: "44444444-4444-4444-4444-444444444444",
      title: "Family",
      slug: "family",
      description: null,
    });
  });
});

// ---------------------------------------------------------------------------
// mapImage
// ---------------------------------------------------------------------------

describe("mapImage", () => {
  const base: SourceImage = {
    id: "55555555-5555-5555-5555-555555555555",
    pageId: null,
    originalUrl: "https://origin.example.com/photos/hero.jpg",
    url: "https://cdn.example.com/photos/hero-optimized.jpg?w=800",
    alt: "A hero",
    title: "Hero",
    caption: "Caption",
    credit: "Photographer",
    width: 800,
    height: 600,
    mimeType: "image/jpeg",
    fileSize: 12345,
    role: "hero",
    position: 0,
  };

  it("maps image fields and derives the filename from the optimized url", () => {
    expect(mapImage(base)).toEqual({
      id: "55555555-5555-5555-5555-555555555555",
      alt: "A hero",
      caption: "Caption",
      credit: "Photographer",
      filename: "hero-optimized.jpg",
      mimeType: "image/jpeg",
      filesize: 12345,
      width: 800,
      height: 600,
      sourceUrl: "https://origin.example.com/photos/hero.jpg",
      url: "https://cdn.example.com/photos/hero-optimized.jpg?w=800",
    });
  });

  it("falls back to originalUrl for the filename when url is empty", () => {
    expect(mapImage({ ...base, url: "" }).filename).toBe("hero.jpg");
  });

  it("derives a filename from a non-absolute url path", () => {
    expect(
      mapImage({ ...base, url: "/uploads/local-file.png" }).filename,
    ).toBe("local-file.png");
  });
});

// ---------------------------------------------------------------------------
// mapPost
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<SourcePage> = {}): SourcePage {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    slug: "my-post",
    title: "My Post",
    subtitle: "A subtitle",
    excerpt: "An excerpt",
    status: "published",
    language: "en",
    canonicalUrl: "https://www.headout.com/blog/my-post/",
    pathname: "/blog/my-post/",
    parentPath: "/blog/",
    featuredImageUrl: "https://cdn.example.com/hero.jpg",
    featuredImageAlt: "Hero",
    cleanedHtml: "<p>clean</p>",
    richText: { type: "root", children: [] },
    componentTree: [{ blockType: "paragraph", text: "Body" }],
    readingTimeMinutes: 4,
    wordCount: 800,
    publishedAt: "2026-01-02T03:04:05.000Z",
    modifiedAt: "2026-02-02T03:04:05.000Z",
    authorId: "author-1",
    primaryCategoryId: "cat-primary",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<SourcePageBundle> = {}): SourcePageBundle {
  return {
    page: makePage(),
    authorId: "author-1",
    categoryIds: ["cat-primary", "cat-2"],
    tagIds: ["tag-1", "tag-2"],
    images: [],
    breadcrumbs: [
      { label: "Post", url: "/blog/my-post/", position: 2 },
      { label: "Home", url: "/", position: 0 },
      { label: "Blog", url: "/blog/", position: 1 },
    ],
    faq: [
      { id: "f2", question: "Q2", answer: "A2", position: 1 },
      { id: "f1", question: "Q1", answer: "A1", position: 0 },
    ],
    jsonld: [{ type: "Article", data: { headline: "My Post" } }],
    seo: {
      metaTitle: "Meta Title",
      metaDescription: "Meta Desc",
      canonicalUrl: "https://seo.example.com/my-post/",
      robots: "index, follow",
      ogTitle: "OG Title",
      ogDescription: "OG Desc",
      ogImage: "https://cdn.example.com/og.jpg",
      twitterCard: "summary_large_image",
      twitterTitle: "TW Title",
      twitterDescription: "TW Desc",
      twitterImage: "https://cdn.example.com/tw.jpg",
      keywords: ["a", "b"],
    },
    internalLinks: [],
    externalLinks: [],
    metadata: null,
    ...overrides,
  };
}

describe("mapPost", () => {
  it("resolves relationship ids for author, categories, primary category, tags and hero image", () => {
    const doc = mapPost(makeBundle(), "hero-media-id");
    expect(doc.author).toBe("author-1");
    expect(doc.categories).toEqual(["cat-primary", "cat-2"]);
    expect(doc.primaryCategory).toBe("cat-primary");
    expect(doc.tags).toEqual(["tag-1", "tag-2"]);
    expect(doc.heroImage).toBe("hero-media-id");
  });

  it("sets heroImage to null when no media id is resolved", () => {
    expect(mapPost(makeBundle(), null).heroImage).toBeNull();
  });

  it("builds the layout from the page componentTree", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.layout).toEqual([{ blockType: "paragraph", text: "Body" }]);
  });

  it("preserves lossless richText content and cleaned html", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.content).toEqual({ type: "root", children: [] });
    expect(doc.contentHtml).toBe("<p>clean</p>");
  });

  it("defaults richText content to null when missing", () => {
    const bundle = makeBundle({ page: makePage({ richText: null }) });
    expect(mapPost(bundle, null).content).toBeNull();
  });

  it("maps published status to `published` and anything else to `draft`", () => {
    expect(mapPost(makeBundle(), null)._status).toBe("published");
    const draft = makeBundle({ page: makePage({ status: "draft" }) });
    expect(mapPost(draft, null)._status).toBe("draft");
    const review = makeBundle({ page: makePage({ status: "in-review" }) });
    expect(mapPost(review, null)._status).toBe("draft");
  });

  it("normalizes publishedAt to ISO and tolerates Date inputs", () => {
    expect(mapPost(makeBundle(), null).publishedAt).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    const withDate = makeBundle({
      page: makePage({ publishedAt: new Date("2026-03-04T05:06:07.000Z") }),
    });
    expect(mapPost(withDate, null).publishedAt).toBe(
      "2026-03-04T05:06:07.000Z",
    );
  });

  it("returns null publishedAt for missing or unparseable dates", () => {
    expect(
      mapPost(makeBundle({ page: makePage({ publishedAt: null }) }), null)
        .publishedAt,
    ).toBeNull();
    expect(
      mapPost(
        makeBundle({ page: makePage({ publishedAt: "not-a-date" }) }),
        null,
      ).publishedAt,
    ).toBeNull();
  });

  it("builds the meta block from seo, falling back to page canonical url", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.meta).toEqual({
      title: "Meta Title",
      description: "Meta Desc",
      image: "https://cdn.example.com/og.jpg",
      canonicalUrl: "https://seo.example.com/my-post/",
      robots: "index, follow",
      keywords: ["a", "b"],
      ogTitle: "OG Title",
      ogDescription: "OG Desc",
      twitterCard: "summary_large_image",
    });
  });

  it("falls back to nulls and the page canonical url when seo is absent", () => {
    const doc = mapPost(makeBundle({ seo: null }), null);
    expect(doc.meta).toEqual({
      title: null,
      description: null,
      image: null,
      canonicalUrl: "https://www.headout.com/blog/my-post/",
      robots: null,
      keywords: null,
      ogTitle: null,
      ogDescription: null,
      twitterCard: null,
    });
  });

  it("sorts breadcrumbs and faq by position and strips internal fields", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.breadcrumbs).toEqual([
      { label: "Home", url: "/" },
      { label: "Blog", url: "/blog/" },
      { label: "Post", url: "/blog/my-post/" },
    ]);
    expect(doc.faq).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
  });

  it("does not mutate the source breadcrumb/faq arrays while sorting", () => {
    const bundle = makeBundle();
    const firstBreadcrumb = bundle.breadcrumbs[0];
    const firstFaq = bundle.faq[0];
    mapPost(bundle, null);
    expect(bundle.breadcrumbs[0]).toBe(firstBreadcrumb);
    expect(bundle.faq[0]).toBe(firstFaq);
  });

  it("maps structured data preserving type and data payloads", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.structuredData).toEqual([
      { type: "Article", data: { headline: "My Post" } },
    ]);
  });

  it("carries the url block and reading/word counts", () => {
    const doc = mapPost(makeBundle(), null);
    expect(doc.url).toEqual({
      canonicalUrl: "https://www.headout.com/blog/my-post/",
      pathname: "/blog/my-post/",
      parentPath: "/blog/",
    });
    expect(doc.readingTimeMinutes).toBe(4);
    expect(doc.wordCount).toBe(800);
  });

  it("emits inline images sorted by position, excluding the hero", () => {
    const mkImage = (
      id: string,
      role: string,
      position: number,
    ): SourceImage => ({
      id,
      pageId: "page-1",
      originalUrl: `https://origin/${id}.jpg`,
      url: `https://cdn/${id}.jpg`,
      alt: `alt ${id}`,
      title: null,
      caption: null,
      credit: null,
      width: 100,
      height: 100,
      mimeType: "image/jpeg",
      fileSize: 1,
      role,
      position,
    });
    const bundle = makeBundle({
      images: [
        mkImage("hero-id", "featured", 0),
        mkImage("inline-b", "inline", 2),
        mkImage("inline-a", "inline", 1),
      ],
    });
    const doc = mapPost(bundle, "hero-id");
    expect(doc.inlineImages).toEqual([
      { image: "inline-a", role: "inline", position: 1 },
      { image: "inline-b", role: "inline", position: 2 },
    ]);
  });

  it("emits internal and external links sorted by position", () => {
    const bundle = makeBundle({
      internalLinks: [
        { href: "/b/", anchorText: "B", rel: null, position: 1 },
        { href: "/a/", anchorText: "A", rel: "nofollow", position: 0 },
      ],
      externalLinks: [
        {
          href: "https://y.com/",
          anchorText: "Y",
          rel: null,
          domain: "y.com",
          position: 1,
        },
        {
          href: "https://x.com/",
          anchorText: "X",
          rel: "sponsored",
          domain: "x.com",
          position: 0,
        },
      ],
    });
    const doc = mapPost(bundle, null);
    expect(doc.links.internal).toEqual([
      { href: "/a/", anchorText: "A", rel: "nofollow", position: 0 },
      { href: "/b/", anchorText: "B", rel: null, position: 1 },
    ]);
    expect(doc.links.external).toEqual([
      {
        href: "https://x.com/",
        anchorText: "X",
        rel: "sponsored",
        domain: "x.com",
        position: 0,
      },
      {
        href: "https://y.com/",
        anchorText: "Y",
        rel: null,
        domain: "y.com",
        position: 1,
      },
    ]);
  });

  it("passes the raw metadata bag through, or null when absent", () => {
    expect(mapPost(makeBundle(), null).metadata).toBeNull();
    const meta = {
      metaTags: [{ name: "robots", content: "index,follow" }],
      httpHeaders: { "cache-control": "max-age=3600" },
      openGraph: { "og:type": "article" },
      twitter: { "twitter:card": "summary_large_image" },
      custom: { theme: "autumn" },
    };
    const doc = mapPost(makeBundle({ metadata: meta }), null);
    expect(doc.metadata).toEqual(meta);
  });
});
