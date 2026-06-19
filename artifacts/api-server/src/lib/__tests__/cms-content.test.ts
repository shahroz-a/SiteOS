import { describe, it, expect } from "vitest";
import {
  slugify,
  uniquify,
  canonicalUrlForSlug,
  pathnameForSlug,
  buildPageValues,
  scaffoldToInput,
  cloneForDuplicate,
  type CmsPostInput,
  type CmsPostDetail,
} from "../cms-content";

describe("slugify", () => {
  it("lowercases, strips accents, and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("strips leading/trailing hyphens and non-alphanumerics", () => {
    expect(slugify("--Trim! Me--")).toBe("trim-me");
    expect(slugify("a/b\\c")).toBe("a-b-c");
  });
});

describe("uniquify", () => {
  it("returns the base when free", () => {
    expect(uniquify("post", new Set())).toBe("post");
  });

  it("appends an incrementing suffix on collision", () => {
    expect(uniquify("post", new Set(["post"]))).toBe("post-2");
    expect(uniquify("post", new Set(["post", "post-2"]))).toBe("post-3");
  });
});

describe("canonical/pathname helpers", () => {
  it("builds the migrated /blog/<slug>/ shape", () => {
    expect(canonicalUrlForSlug("rome-guide")).toBe(
      "https://www.headout.com/blog/rome-guide/",
    );
    expect(pathnameForSlug("rome-guide")).toBe("/blog/rome-guide/");
  });
});

describe("buildPageValues", () => {
  const resolved = {
    slug: "my-post",
    canonicalUrl: "https://www.headout.com/blog/my-post/",
    pathname: "/blog/my-post/",
  };

  it("defaults status to draft and language to en", () => {
    const input = { title: "My Post", slug: "my-post" } as CmsPostInput;
    const values = buildPageValues(input, resolved);
    expect(values.status).toBe("draft");
    expect(values.language).toBe("en");
    expect(values.pageType).toBe("post");
    expect(values.slug).toBe("my-post");
    expect(values.canonicalUrl).toBe(resolved.canonicalUrl);
    expect(values.pathname).toBe(resolved.pathname);
  });

  it("honors an explicit status and maps content fields", () => {
    const input = {
      title: "My Post",
      slug: "my-post",
      status: "published",
      excerpt: "An excerpt",
      contentHtml: "<p>hi</p>",
      publishedAt: "2026-01-02T00:00:00.000Z",
    } as unknown as CmsPostInput;
    const values = buildPageValues(input, resolved);
    expect(values.status).toBe("published");
    expect(values.excerpt).toBe("An excerpt");
    expect(values.cleanedHtml).toBe("<p>hi</p>");
    expect(values.publishedAt).toBeInstanceOf(Date);
    expect((values.publishedAt as Date).toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("leaves publishedAt null when not provided", () => {
    const input = { title: "X", slug: "x" } as CmsPostInput;
    expect(buildPageValues(input, resolved).publishedAt).toBeNull();
  });
});

describe("scaffoldToInput", () => {
  it("produces an empty titled draft", () => {
    const input = scaffoldToInput({ title: "Blank", slug: "blank" });
    expect(input.title).toBe("Blank");
    expect(input.slug).toBe("blank");
    expect(input.status).toBe("draft");
    expect(input.categoryIds).toEqual([]);
    expect(input.faq).toEqual([]);
    expect(input.images).toEqual([]);
  });

  it("allows an omitted slug", () => {
    const input = scaffoldToInput({ title: "Blank" });
    expect(input.slug).toBeUndefined();
  });
});

describe("cloneForDuplicate", () => {
  const source: CmsPostDetail = {
    id: "src-id",
    slug: "original",
    status: "published",
    pageType: "post",
    title: "Original",
    subtitle: "Sub",
    excerpt: "Ex",
    canonicalUrl: "https://www.headout.com/blog/original/",
    pathname: "/blog/original/",
    parentPath: null,
    featuredImageUrl: "https://img/feat.jpg",
    featuredImageAlt: "Feat",
    readingTimeMinutes: 5,
    wordCount: 900,
    language: "en",
    publishedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: null,
    updatedAt: null,
    contentHtml: "<p>body</p>",
    richText: { type: "root", children: [] },
    componentTree: null,
    latestVersion: 1,
    author: { id: "auth-1", name: "A", slug: "a" } as never,
    primaryCategory: { id: "cat-1", name: "C", slug: "c" } as never,
    categories: [{ id: "cat-1", name: "C", slug: "c" }] as never,
    tags: [{ id: "tag-1", name: "T", slug: "t" }] as never,
    seo: {
      metaTitle: "Meta",
      metaDescription: "Desc",
      canonicalUrl: "https://www.headout.com/blog/original/",
      robots: "index,follow",
      focusKeyword: "rome",
      keywords: ["rome"],
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      ogType: null,
      twitterCard: null,
      twitterTitle: null,
      twitterDescription: null,
      twitterImage: null,
      needsReview: false,
    } as never,
    faq: [{ question: "Q", answer: "A", position: 0 }] as never,
    breadcrumbs: [{ label: "Home", url: "/", position: 0 }] as never,
    jsonld: [{ type: "Article", data: { "@type": "Article" } }] as never,
    images: [
      {
        url: "https://img/1.jpg",
        originalUrl: null,
        alt: "one",
        title: null,
        caption: null,
        credit: null,
        width: 100,
        height: 100,
        mimeType: "image/jpeg",
        role: "inline",
        position: 0,
      },
    ] as never,
    galleries: [] as never,
    internalLinks: [
      {
        href: "/blog/other/",
        anchorText: "other",
        rel: null,
        domain: null,
        position: 0,
      },
    ] as never,
    externalLinks: [] as never,
  };

  it("resets identity: new title, draft status, no slug/publishedAt, SEO needsReview", () => {
    const input = cloneForDuplicate(source, { title: "Original (Copy)" });
    expect(input.title).toBe("Original (Copy)");
    expect(input.slug).toBeUndefined();
    expect(input.status).toBe("draft");
    expect(input.publishedAt).toBeNull();
    expect(input.seo?.needsReview).toBe(true);
    expect(input.seo?.canonicalUrl).toBeNull();
  });

  it("carries over content, taxonomy, and nested rows", () => {
    const input = cloneForDuplicate(source, {
      title: "Copy",
      slug: "copy-slug",
    });
    expect(input.slug).toBe("copy-slug");
    expect(input.contentHtml).toBe("<p>body</p>");
    expect(input.categoryIds).toEqual(["cat-1"]);
    expect(input.tagIds).toEqual(["tag-1"]);
    expect(input.authorId).toBe("auth-1");
    expect(input.primaryCategoryId).toBe("cat-1");
    expect(input.faq).toHaveLength(1);
    expect(input.images).toHaveLength(1);
    expect(input.internalLinks).toHaveLength(1);
    expect(input.changeSummary).toContain("Duplicated from");
  });

  it("defaults SEO to needsReview when the source has none", () => {
    const noSeo = { ...source, seo: null } as CmsPostDetail;
    const input = cloneForDuplicate(noSeo, { title: "Copy" });
    expect(input.seo).toEqual({ needsReview: true });
  });
});
