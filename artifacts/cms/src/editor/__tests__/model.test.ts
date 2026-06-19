import { describe, expect, it } from "vitest";
import type { CmsPostDetail } from "@workspace/api-client-react";
import type { CTNode } from "@workspace/blog-renderer";
import {
  blocksToComponentTree,
  blocksFromDetail,
  detailToInput,
  createBlock,
  type EditorBlock,
} from "../model";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeDetail(overrides: Partial<CmsPostDetail> = {}): CmsPostDetail {
  return {
    id: "page-1",
    slug: "my-post",
    status: "published",
    pageType: "article",
    title: "My Post",
    canonicalUrl: "https://example.com/blog/my-post",
    pathname: "/blog/my-post",
    language: "en",
    categories: [],
    tags: [],
    breadcrumbs: [],
    faq: [],
    images: [],
    galleries: [],
    jsonld: [],
    internalLinks: [],
    externalLinks: [],
    ...overrides,
  };
}

/**
 * Regression coverage for "writer-inserted library images show on the published
 * article". The public blog renders an article body from `contentHtml` ->
 * `componentTree` -> `richText` (first non-empty wins), so for the editor's edits
 * to take effect it MUST (a) write the inserted image into `componentTree` — the
 * structure the blog actually renders — and (b) null out `contentHtml` so the
 * structured tree is the one that renders. These tests lock that contract in.
 */

function baseDetail(overrides: Partial<CmsPostDetail> = {}): CmsPostDetail {
  return {
    id: "page-1",
    slug: "best-of-nyc",
    status: "draft",
    pageType: "post",
    title: "Best of NYC",
    subtitle: null,
    excerpt: null,
    canonicalUrl: "https://www.headout.com/blog/best-of-nyc/",
    pathname: "/blog/best-of-nyc/",
    parentPath: null,
    featuredImageUrl: "https://cdn.headout.com/hero.jpg",
    featuredImageAlt: "skyline",
    readingTimeMinutes: 5,
    wordCount: 800,
    language: "en",
    publishedAt: null,
    modifiedAt: null,
    updatedAt: null,
    contentHtml: null,
    richText: null,
    componentTree: null,
    author: null,
    primaryCategory: null,
    categories: [],
    tags: [],
    breadcrumbs: [],
    faq: [],
    images: [],
    galleries: [],
    seo: null,
    jsonld: [],
    internalLinks: [],
    externalLinks: [],
    latestVersion: null,
    ...overrides,
  };
}

/** Strip the random `id` from every block so trees compare structurally. */
function stripIds(blocks: EditorBlock[]): Omit<EditorBlock, "id" | "children">[] {
  return blocks.map((b) => {
    const { id: _id, children, ...rest } = b;
    const out: Record<string, unknown> = { ...rest };
    if (children) out.children = stripIds(children);
    return out as Omit<EditorBlock, "id" | "children">;
  });
}

function imageBlock(src: string, alt = "library shot"): EditorBlock {
  const b = createBlock("image");
  b.data.src = src;
  b.data.alt = alt;
  return b;
}

/* ------------------------------------------------------------------ */
/* createBlock                                                         */
/* ------------------------------------------------------------------ */

describe("createBlock", () => {
  it("gives each block a unique id and the requested type", () => {
    const a = createBlock("heading");
    const b = createBlock("heading");
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe("heading");
  });

  it("seeds sensible defaults per block type", () => {
    expect(createBlock("heading")).toMatchObject({ text: "", data: { level: 2 } });
    expect(createBlock("richText").data).toEqual({ html: "" });
    expect(createBlock("section")).toMatchObject({ data: { heading: "" }, children: [] });
    expect(createBlock("table").data.rows).toEqual([
      ["Column 1", "Column 2"],
      ["", ""],
    ]);
    expect(createBlock("faq").data.entries).toEqual([{ question: "", answer: "" }]);
  });
});

/* ------------------------------------------------------------------ */
/* blocks -> componentTree                                            */
/* ------------------------------------------------------------------ */

describe("blocksToComponentTree", () => {
  it("emits the crawler array shape keyed by `type`", () => {
    const blocks: EditorBlock[] = [
      { id: "1", type: "heading", text: "Title", data: { level: 3 } },
      { id: "2", type: "richText", data: { html: "<p>Body</p>" } },
    ];
    expect(blocksToComponentTree(blocks)).toEqual([
      { type: "heading", text: "Title", data: { level: 3 } },
      { type: "richText", data: { html: "<p>Body</p>" } },
    ]);
  });

  it("recurses into section children", () => {
    const blocks: EditorBlock[] = [
      {
        id: "s",
        type: "section",
        data: { heading: "Group" },
        children: [{ id: "h", type: "heading", text: "Inner", data: { level: 2 } }],
      },
    ];
    expect(blocksToComponentTree(blocks)).toEqual([
      {
        type: "section",
        data: { heading: "Group" },
        children: [{ type: "heading", text: "Inner", data: { level: 2 } }],
      },
    ]);
  });

  it("fills missing fields with empty defaults (no undefined leaks)", () => {
    const tree = blocksToComponentTree([{ id: "1", type: "hero", data: {} }]);
    expect(tree[0]).toEqual({
      type: "hero",
      data: { title: "", subtitle: "", eyebrow: "", imageUrl: "", imageAlt: "" },
    });
  });
});

/* ------------------------------------------------------------------ */
/* round-trip: blocks -> componentTree -> blocks                      */
/* ------------------------------------------------------------------ */

describe("componentTree round-trip", () => {
  it("preserves a flat block list through detail -> blocks", () => {
    const blocks: EditorBlock[] = [
      { id: "1", type: "heading", text: "Title", data: { level: 2 } },
      { id: "2", type: "richText", data: { html: "<p>Body</p>" } },
      { id: "3", type: "quote", text: "A wise saying", data: { cite: "Someone" } },
    ];
    const tree = blocksToComponentTree(blocks);
    const detail = makeDetail({ componentTree: tree as CmsPostDetail["componentTree"] });
    expect(stripIds(blocksFromDetail(detail))).toEqual(stripIds(blocks));
  });

  it("preserves nested collections (section with children)", () => {
    const blocks: EditorBlock[] = [
      {
        id: "s",
        type: "section",
        data: { heading: "Group" },
        children: [
          { id: "h", type: "heading", text: "Inner", data: { level: 2 } },
          { id: "r", type: "richText", data: { html: "<p>Nested</p>" } },
        ],
      },
    ];
    const tree = blocksToComponentTree(blocks);
    const detail = makeDetail({ componentTree: tree as CmsPostDetail["componentTree"] });
    const back = blocksFromDetail(detail);
    expect(stripIds(back)).toEqual(stripIds(blocks));
    expect(back[0]!.children).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* blocksFromDetail load paths                                        */
/* ------------------------------------------------------------------ */

describe("blocksFromDetail", () => {
  it("wraps an HTML-only (legacy) article in a single rich-text block", () => {
    const detail = makeDetail({ contentHtml: "<p>Imported body</p>" });
    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "richText", data: { html: "<p>Imported body</p>" } });
  });

  it("prefers contentHtml over componentTree when both are present", () => {
    const detail = makeDetail({
      contentHtml: "<p>Legacy wins</p>",
      componentTree: [{ type: "heading", text: "Ignored", data: { level: 2 } }] as CmsPostDetail["componentTree"],
    });
    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "richText", data: { html: "<p>Legacy wins</p>" } });
  });

  it("treats blank/whitespace contentHtml as empty and uses componentTree", () => {
    const detail = makeDetail({
      contentHtml: "   ",
      componentTree: [{ type: "heading", text: "Real", data: { level: 2 } }] as CmsPostDetail["componentTree"],
    });
    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "heading", text: "Real" });
  });

  it("returns an empty list when there is neither HTML nor a tree", () => {
    expect(blocksFromDetail(makeDetail())).toEqual([]);
  });

  it("reads the importer root-object shape ({ children: [...] })", () => {
    const detail = makeDetail({
      componentTree: {
        children: [
          { blockType: "heading", text: "Heading", data: { level: 2 } },
          { blockType: "paragraph", text: "Hello world" },
          { blockType: "list", data: { items: ["one", "two"], ordered: true } },
        ],
      } as CmsPostDetail["componentTree"],
    });
    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "heading", text: "Heading" });
    expect(blocks[1]).toMatchObject({ type: "richText", data: { html: "<p>Hello world</p>" } });
    expect(blocks[2]).toMatchObject({ type: "richText", data: { html: "<ol><li>one</li><li>two</li></ol>" } });
  });

  it("falls back unknown nodes to editable rich text", () => {
    const detail = makeDetail({
      componentTree: [{ type: "mystery-widget", text: "salvage me" }] as CmsPostDetail["componentTree"],
    });
    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "richText", data: { html: "<p>salvage me</p>" } });
  });
});

/* ------------------------------------------------------------------ */
/* detailToInput (the autosave payload)                               */
/* ------------------------------------------------------------------ */

describe("detailToInput", () => {
  const blocks: EditorBlock[] = [
    { id: "1", type: "heading", text: "Title", data: { level: 2 } },
    { id: "2", type: "richText", data: { html: "<p>Body</p>" } },
  ];

  it("forces contentHtml and richText to null and renders from componentTree", () => {
    const input = detailToInput(makeDetail(), blocks, { title: "My Post" });
    expect(input.contentHtml).toBeNull();
    expect(input.richText).toBeNull();
    expect(input.componentTree).toEqual(blocksToComponentTree(blocks));
  });

  it("applies the edited header metadata", () => {
    const input = detailToInput(makeDetail(), blocks, {
      title: "New Title",
      subtitle: "A subtitle",
      excerpt: "An excerpt",
    });
    expect(input).toMatchObject({
      title: "New Title",
      subtitle: "A subtitle",
      excerpt: "An excerpt",
    });
  });

  it("normalizes omitted metadata to null", () => {
    const input = detailToInput(makeDetail(), blocks, { title: "Only Title" });
    expect(input.subtitle).toBeNull();
    expect(input.excerpt).toBeNull();
  });

  it("round-trips nested collections from the loaded detail (PUT rewrites them all)", () => {
    const detail = makeDetail({
      slug: "kept-slug",
      author: { id: "a1", name: "Ann", slug: "ann" },
      primaryCategory: { id: "c1", name: "Travel", slug: "travel" },
      categories: [
        { id: "c1", name: "Travel", slug: "travel" },
        { id: "c2", name: "Food", slug: "food" },
      ],
      tags: [{ id: "t1", name: "Tips", slug: "tips" }],
      faq: [{ id: "f1", question: "Q?", answer: "A.", position: 0 }],
      images: [
        {
          id: "i1",
          url: "https://cdn/img.jpg",
          originalUrl: "https://cdn/orig.jpg",
          alt: "alt",
          position: 0,
        },
      ],
      internalLinks: [{ href: "/blog/other", anchorText: "Other", position: 0 }],
    });
    const input = detailToInput(detail, blocks, { title: "My Post" });
    expect(input.slug).toBe("kept-slug");
    expect(input.authorId).toBe("a1");
    expect(input.primaryCategoryId).toBe("c1");
    expect(input.categoryIds).toEqual(["c1", "c2"]);
    expect(input.tagIds).toEqual(["t1"]);
    expect(input.faq).toEqual([{ question: "Q?", answer: "A.", position: 0 }]);
    expect(input.images).toHaveLength(1);
    expect(input.images?.[0]).toMatchObject({ url: "https://cdn/img.jpg", position: 0 });
    expect(input.internalLinks).toEqual([
      { href: "/blog/other", anchorText: "Other", rel: null, domain: null, position: 0 },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* inserted library images reach the rendered structure               */
/* ------------------------------------------------------------------ */

describe("editor model — inserted images reach the rendered structure", () => {
  it("writes an inserted image into componentTree and nulls contentHtml", () => {
    const detail = baseDetail();
    const blocks: EditorBlock[] = [
      createBlock("richText"),
      imageBlock("https://cdn.headout.com/library/skyline.jpg"),
    ];
    blocks[0].data.html = "<p>Intro paragraph.</p>";

    const input = detailToInput(detail, blocks, { title: "Best of NYC" });

    // The blog only renders the structured tree when there's no HTML body.
    expect(input.contentHtml).toBeNull();
    expect(input.richText).toBeNull();

    const tree = input.componentTree as CTNode[];
    expect(Array.isArray(tree)).toBe(true);
    const img = tree.find((n) => n.type === "image");
    expect(img).toBeDefined();
    expect(img?.data?.src).toBe("https://cdn.headout.com/library/skyline.jpg");
    expect(img?.data?.alt).toBe("library shot");
  });

  it("carries hero, gallery and image library picks through to componentTree", () => {
    const hero = createBlock("hero");
    hero.data.imageUrl = "https://cdn.headout.com/library/hero.jpg";
    hero.data.imageAlt = "hero alt";
    const gallery = createBlock("gallery");
    gallery.data.images = [
      { src: "https://cdn.headout.com/library/g1.jpg", alt: "g1" },
      { src: "https://cdn.headout.com/library/g2.jpg", alt: "g2" },
    ];

    const tree = blocksToComponentTree([
      hero,
      gallery,
      imageBlock("https://cdn.headout.com/library/body.jpg"),
    ]) as CTNode[];

    expect(tree.find((n) => n.type === "hero")?.data?.imageUrl).toBe(
      "https://cdn.headout.com/library/hero.jpg",
    );
    const galleryNode = tree.find((n) => n.type === "gallery");
    expect(galleryNode?.data?.images?.map((i) => i.src)).toEqual([
      "https://cdn.headout.com/library/g1.jpg",
      "https://cdn.headout.com/library/g2.jpg",
    ]);
    expect(tree.find((n) => n.type === "image")?.data?.src).toBe(
      "https://cdn.headout.com/library/body.jpg",
    );
  });

  it("loads a legacy contentHtml article as one editable rich-text block", () => {
    const detail = baseDetail({
      contentHtml: "<p>Crawled body with an <img src='x.jpg'></p>",
      componentTree: [{ type: "richText", data: { html: "<p>tree</p>" } }],
    });

    const blocks = blocksFromDetail(detail);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("richText");
    expect(blocks[0].data.html).toContain("Crawled body");
  });

  it("recovers an image block from an editor-authored componentTree on reload", () => {
    const detail = baseDetail({
      contentHtml: null,
      componentTree: [
        { type: "richText", data: { html: "<p>Body.</p>" } },
        {
          type: "image",
          data: { src: "https://cdn.headout.com/library/round-trip.jpg", alt: "rt" },
        },
      ],
    });

    const blocks = blocksFromDetail(detail);
    const img = blocks.find((b) => b.type === "image");
    expect(img?.data.src).toBe("https://cdn.headout.com/library/round-trip.jpg");

    // Re-emitting must keep the image in the rendered structure.
    const reEmitted = detailToInput(detail, blocks, { title: detail.title });
    const tree = reEmitted.componentTree as CTNode[];
    expect(tree.find((n) => n.type === "image")?.data?.src).toBe(
      "https://cdn.headout.com/library/round-trip.jpg",
    );
  });

  it("preserves existing nested collections on save (no content dropped)", () => {
    const detail = baseDetail({
      images: [
        {
          url: "https://cdn.headout.com/existing.jpg",
          originalUrl: null,
          alt: "existing",
          caption: null,
          credit: null,
          width: null,
          height: null,
          role: "featured",
          position: 0,
        },
      ],
      faq: [{ question: "Q?", answer: "A.", position: 0 }],
      seo: {
        metaTitle: "Meta",
        metaDescription: "Desc",
        canonicalUrl: null,
        robots: null,
        focusKeyword: null,
        keywords: null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        ogType: null,
        twitterCard: null,
        twitterTitle: null,
        twitterDescription: null,
        twitterImage: null,
        needsReview: false,
      },
    } as Partial<CmsPostDetail>);

    const input = detailToInput(detail, [imageBlock("https://cdn.headout.com/new.jpg")], {
      title: detail.title,
    });

    expect(input.images?.map((i) => i.url)).toEqual([
      "https://cdn.headout.com/existing.jpg",
    ]);
    expect(input.faq?.map((f) => f.question)).toEqual(["Q?"]);
    expect(input.seo?.metaTitle).toBe("Meta");
  });
});
