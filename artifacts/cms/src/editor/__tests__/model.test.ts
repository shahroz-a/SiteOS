import { describe, it, expect } from "vitest";
import type { CmsPostDetail } from "@workspace/api-client-react";
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

/** Strip the random `id` from every block so trees compare structurally. */
function stripIds(blocks: EditorBlock[]): Omit<EditorBlock, "id" | "children">[] {
  return blocks.map((b) => {
    const { id: _id, children, ...rest } = b;
    const out: Record<string, unknown> = { ...rest };
    if (children) out.children = stripIds(children);
    return out as Omit<EditorBlock, "id" | "children">;
  });
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
