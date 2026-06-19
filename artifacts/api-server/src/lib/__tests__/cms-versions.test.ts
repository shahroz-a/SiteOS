import { describe, it, expect } from "vitest";
import { diffSnapshots } from "../cms-versions";
import { snapshotToInput, type CmsPostDetail } from "../cms-content";

/** A fully-populated snapshot used as the diff/round-trip baseline. */
function makeSnapshot(overrides: Partial<CmsPostDetail> = {}): CmsPostDetail {
  const base: CmsPostDetail = {
    id: "page-1",
    slug: "rome-guide",
    status: "published",
    pageType: "post",
    title: "The Ultimate Rome Guide",
    subtitle: "Everything you need",
    excerpt: "A short summary.",
    canonicalUrl: "https://www.headout.com/blog/rome-guide/",
    pathname: "/blog/rome-guide/",
    originalUrl: null,
    scheduledFor: null,
    redirects: [],
    parentPath: null,
    featuredImageUrl: "https://img/hero.jpg",
    featuredImageAlt: "Colosseum",
    readingTimeMinutes: 7,
    wordCount: 1400,
    language: "en",
    publishedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: null,
    updatedAt: "2026-02-01T00:00:00.000Z",
    contentHtml: "<p>body</p>",
    richText: { type: "root", children: [] },
    componentTree: null,
    author: {
      id: "auth-1",
      name: "Alice",
      slug: "alice",
      avatarUrl: null,
      role: null,
    },
    primaryCategory: { id: "cat-1", name: "Italy", slug: "italy" },
    categories: [{ id: "cat-1", name: "Italy", slug: "italy" }],
    tags: [{ id: "tag-1", name: "Travel", slug: "travel" }],
    breadcrumbs: [{ label: "Home", url: "/", position: 0 }],
    faq: [{ id: "f-1", question: "When?", answer: "Spring", position: 0 }],
    images: [
      {
        id: "img-1",
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
    ],
    galleries: [],
    seo: {
      metaTitle: "Meta",
      metaDescription: "Desc",
      canonicalUrl: "https://www.headout.com/blog/rome-guide/",
      robots: "index,follow",
      focusKeyword: "rome",
      keywords: ["rome", "italy"],
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
    jsonld: [{ type: "Article", data: { "@type": "Article" } }],
    internalLinks: [
      {
        id: "l-1",
        href: "/blog/other/",
        anchorText: "other",
        rel: null,
        domain: null,
        position: 0,
      },
    ],
    externalLinks: [],
    latestVersion: 3,
  };
  return { ...base, ...overrides };
}

describe("diffSnapshots", () => {
  it("returns no changes for identical snapshots", () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it("detects a changed scalar field with before/after values", () => {
    const before = makeSnapshot({ title: "Old Title" });
    const after = makeSnapshot({ title: "New Title" });
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "title",
      label: "Title",
      before: "Old Title",
      after: "New Title",
    });
  });

  it("flattens author and primaryCategory to their names", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      author: {
        id: "auth-2",
        name: "Bob",
        slug: "bob",
        avatarUrl: null,
        role: null,
      },
    });
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "author",
      before: "Alice",
      after: "Bob",
    });
  });

  it("diffs list fields structurally (categories, tags)", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      tags: [
        { id: "tag-1", name: "Travel", slug: "travel" },
        { id: "tag-2", name: "Food", slug: "food" },
      ],
    });
    const changes = diffSnapshots(before, after);
    const tagChange = changes.find((c) => c.field === "tags");
    expect(tagChange).toBeDefined();
    expect(tagChange?.before).toEqual(["Travel"]);
    expect(tagChange?.after).toEqual(["Travel", "Food"]);
  });

  it("diffs nested seo fields by dotted key", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      seo: { ...makeSnapshot().seo!, metaTitle: "Changed Meta" },
    });
    const changes = diffSnapshots(before, after);
    expect(changes.map((c) => c.field)).toEqual(["seo.metaTitle"]);
    expect(changes[0]).toMatchObject({
      before: "Meta",
      after: "Changed Meta",
    });
  });

  it("reduces link arrays to counts", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      internalLinks: [
        ...makeSnapshot().internalLinks,
        {
          id: "l-2",
          href: "/blog/more/",
          anchorText: "more",
          rel: null,
          domain: null,
          position: 1,
        },
      ],
    });
    const changes = diffSnapshots(before, after);
    const linkChange = changes.find((c) => c.field === "internalLinks");
    expect(linkChange).toMatchObject({ before: 1, after: 2 });
  });

  it("treats a null `before` as every field being added", () => {
    const after = makeSnapshot();
    const changes = diffSnapshots(null, after);
    // Every field with a non-null/non-empty value should surface.
    expect(changes.length).toBeGreaterThan(0);
    const titleChange = changes.find((c) => c.field === "title");
    expect(titleChange).toMatchObject({ before: null, after: after.title });
  });

  it("normalizes undefined optionals to null so absent ≠ change", () => {
    const before = makeSnapshot({ subtitle: null });
    const after = makeSnapshot({ subtitle: undefined as unknown as null });
    expect(diffSnapshots(before, after)).toEqual([]);
  });
});

describe("snapshotToInput", () => {
  it("maps taxonomy and author to id references", () => {
    const input = snapshotToInput(makeSnapshot());
    expect(input.authorId).toBe("auth-1");
    expect(input.primaryCategoryId).toBe("cat-1");
    expect(input.categoryIds).toEqual(["cat-1"]);
    expect(input.tagIds).toEqual(["tag-1"]);
  });

  it("carries content, slug, status, and publishedAt verbatim", () => {
    const snap = makeSnapshot();
    const input = snapshotToInput(snap);
    expect(input.slug).toBe(snap.slug);
    expect(input.status).toBe(snap.status);
    expect(input.contentHtml).toBe(snap.contentHtml);
    expect(input.publishedAt).toBe(snap.publishedAt);
    expect(input.title).toBe(snap.title);
  });

  it("preserves nested rows (faq, images, internalLinks, seo)", () => {
    const input = snapshotToInput(makeSnapshot());
    expect(input.faq).toHaveLength(1);
    expect(input.faq?.[0]).toMatchObject({ question: "When?", answer: "Spring" });
    expect(input.images).toHaveLength(1);
    expect(input.internalLinks).toHaveLength(1);
    expect(input.seo?.metaTitle).toBe("Meta");
    expect(input.seo?.keywords).toEqual(["rome", "italy"]);
  });

  it("nulls out missing author/primaryCategory rather than throwing", () => {
    const input = snapshotToInput(
      makeSnapshot({ author: null, primaryCategory: null }),
    );
    expect(input.authorId).toBeNull();
    expect(input.primaryCategoryId).toBeNull();
  });

  it("omits seo entirely when the snapshot has none", () => {
    const input = snapshotToInput(makeSnapshot({ seo: null }));
    expect(input.seo).toBeUndefined();
  });
});
