import { describe, expect, it } from "vitest";
import type { CmsPostDetail } from "@workspace/api-client-react";
import { buildCmsPostInput } from "../index";

function makeDetail(overrides: Partial<CmsPostDetail> = {}): CmsPostDetail {
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
    componentTree: [{ type: "richText", data: { html: "<p>Body.</p>" } }],
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
  } as CmsPostDetail;
}

describe("buildCmsPostInput", () => {
  it("preserves the article body unchanged by default", () => {
    const detail = makeDetail();
    const input = buildCmsPostInput(detail);
    expect(input.componentTree).toEqual(detail.componentTree);
    expect(input.contentHtml).toBeNull();
    expect(input.richText).toBeNull();
  });

  it("preserves the loaded banner when meta omits it", () => {
    const input = buildCmsPostInput(makeDetail());
    expect(input.featuredImageUrl).toBe("https://cdn.headout.com/hero.jpg");
    expect(input.featuredImageAlt).toBe("skyline");
  });

  it("applies a chosen banner image", () => {
    const input = buildCmsPostInput(makeDetail(), {
      meta: {
        featuredImageUrl: "https://cdn.headout.com/new-banner.jpg",
        featuredImageAlt: "new alt",
      },
    });
    expect(input.featuredImageUrl).toBe("https://cdn.headout.com/new-banner.jpg");
    expect(input.featuredImageAlt).toBe("new alt");
  });

  it("clears the banner when meta sets it to null", () => {
    const input = buildCmsPostInput(makeDetail(), {
      meta: { featuredImageUrl: null, featuredImageAlt: null },
    });
    expect(input.featuredImageUrl).toBeNull();
    expect(input.featuredImageAlt).toBeNull();
  });

  it("round-trips nested collections so a PUT does not wipe them", () => {
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
    } as Partial<CmsPostDetail>);
    const input = buildCmsPostInput(detail, {
      meta: { featuredImageUrl: "https://cdn/x.jpg", featuredImageAlt: "x" },
    });
    expect(input.slug).toBe("kept-slug");
    expect(input.authorId).toBe("a1");
    expect(input.primaryCategoryId).toBe("c1");
    expect(input.categoryIds).toEqual(["c1", "c2"]);
    expect(input.tagIds).toEqual(["t1"]);
    expect(input.faq).toEqual([{ question: "Q?", answer: "A.", position: 0 }]);
    expect(input.images?.[0]).toMatchObject({ url: "https://cdn/img.jpg", position: 0 });
    expect(input.internalLinks).toEqual([
      { href: "/blog/other", anchorText: "Other", rel: null, domain: null, position: 0 },
    ]);
  });

  it("lets the block editor override the body structure", () => {
    const detail = makeDetail();
    const tree = [{ type: "heading", text: "Title", data: { level: 2 } }];
    const input = buildCmsPostInput(detail, {
      meta: { title: "Best of NYC" },
      componentTree: tree,
      contentHtml: null,
      richText: null,
    });
    expect(input.componentTree).toEqual(tree);
    expect(input.contentHtml).toBeNull();
    expect(input.richText).toBeNull();
  });
});
