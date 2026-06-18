import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  componentTreeToLayout,
  layoutToComponentTree,
  mapAuthor,
  mapCategory,
  mapPost,
  mapTag,
  payloadAuthorToRow,
  payloadCategoryToRow,
  payloadMetaToSeoRow,
  payloadTagToRow,
  type PayloadBlock,
  type SourcePageBundle,
} from "../mapping.js";

// ---------------------------------------------------------------------------
// Pure reverse-mapping round-trips (no DB)
// ---------------------------------------------------------------------------

describe("payload reverse mappers", () => {
  const layout: PayloadBlock[] = [
    { blockType: "heading", level: 1, text: "Title", anchorId: "intro" },
    { blockType: "paragraph", text: "Hello world." },
    {
      blockType: "list",
      ordered: false,
      title: "Where to eat",
      items: ["A", "B", "C"],
    },
    {
      blockType: "section",
      heading: "1. New York",
      anchorId: "nyc",
      content: [
        { blockType: "paragraph", text: "Catch the parade." },
        { blockType: "list", ordered: true, items: ["x", "y"] },
      ],
    },
    { blockType: "html", html: "<table><tr><td>cell</td></tr></table>" },
  ];

  it("round-trips layout -> componentTree -> layout unchanged", () => {
    const tree = layoutToComponentTree(layout);
    expect(tree.type).toBe("root");
    expect(tree.schemaVersion).toBe("1");
    const back = componentTreeToLayout(tree);
    expect(back).toEqual(layout);
  });

  it("reverses author docs (avatar resolved to url)", () => {
    const doc = mapAuthor(
      {
        id: "a1",
        name: "Aiyana",
        slug: "aiyana",
        bio: "bio",
        avatarUrl: "https://cdn/x.jpg",
        role: "Writer",
        email: "a@x.com",
        social: { twitter: "@a" },
      },
      "media-1",
    );
    const row = payloadAuthorToRow(doc, "https://cdn/x.jpg");
    expect(row).toEqual({
      name: "Aiyana",
      slug: "aiyana",
      bio: "bio",
      role: "Writer",
      email: "a@x.com",
      avatarUrl: "https://cdn/x.jpg",
      social: { twitter: "@a" },
    });
  });

  it("reverses category and tag docs", () => {
    const cat = mapCategory({
      id: "c1",
      name: "Family Travel",
      slug: "family-travel",
      description: "desc",
      parentId: null,
    });
    expect(payloadCategoryToRow(cat)).toEqual({
      name: "Family Travel",
      slug: "family-travel",
      description: "desc",
    });

    const tag = mapTag({
      id: "t1",
      name: "Kids",
      slug: "kids",
      description: null,
    });
    expect(payloadTagToRow(tag)).toEqual({
      name: "Kids",
      slug: "kids",
      description: null,
    });
  });

  it("reverses post.meta into an seo row", () => {
    const bundle = makeBundle();
    const post = mapPost(bundle, "media-1");
    const seo = payloadMetaToSeoRow(post);
    expect(seo.metaTitle).toBe("Meta Title");
    expect(seo.metaDescription).toBe("Meta Desc");
    expect(seo.canonicalUrl).toBe("https://site/blog/p/");
    expect(seo.ogImage).toBe("https://cdn/og.jpg");
    expect(seo.keywords).toEqual(["a", "b"]);
  });
});

function makeBundle(): SourcePageBundle {
  return {
    page: {
      id: "p1",
      slug: "p",
      title: "Post",
      subtitle: null,
      excerpt: "ex",
      status: "published",
      language: "en",
      canonicalUrl: "https://site/blog/p/",
      pathname: "/blog/p/",
      parentPath: "/blog/",
      featuredImageUrl: "https://cdn/hero.jpg",
      featuredImageAlt: "Hero",
      cleanedHtml: "<p>ex</p>",
      richText: { root: { children: [] } },
      componentTree: {
        type: "root",
        schemaVersion: "1",
        children: [{ blockType: "paragraph", text: "ex" }],
      },
      readingTimeMinutes: 5,
      wordCount: 100,
      publishedAt: "2025-10-28T09:00:00.000Z",
      modifiedAt: null,
      authorId: "a1",
      primaryCategoryId: "c1",
    },
    authorId: "a1",
    categoryIds: ["c1"],
    tagIds: ["t1"],
    images: [],
    breadcrumbs: [{ label: "Home", url: "https://site/", position: 0 }],
    faq: [{ id: "f1", question: "Q?", answer: "A.", position: 0 }],
    jsonld: [{ type: "Article", data: { "@type": "Article" } }],
    seo: {
      metaTitle: "Meta Title",
      metaDescription: "Meta Desc",
      canonicalUrl: "https://site/blog/p/",
      robots: "index,follow",
      ogTitle: "OG",
      ogDescription: "OGD",
      ogImage: "https://cdn/og.jpg",
      twitterCard: "summary_large_image",
      twitterTitle: "TW",
      twitterDescription: "TWD",
      twitterImage: "https://cdn/tw.jpg",
      keywords: ["a", "b"],
    },
  };
}

// ---------------------------------------------------------------------------
// Importer idempotency against an in-memory fake DB
// ---------------------------------------------------------------------------

interface VersionRow {
  versionNumber: number;
  contentHash: string;
}

class FakeDb {
  pages = new Map<string, string>(); // canonicalUrl -> id
  authors = new Map<string, string>(); // slug -> id
  categories = new Map<string, string>(); // slug -> id
  tags = new Map<string, string>(); // slug -> id
  versions = new Map<string, VersionRow[]>(); // pageId -> versions
  rowCounts: Record<string, number> = {};
  private seq = 0;

  id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
  insert(table: { __table: string }) {
    return new InsertBuilder(this, table.__table);
  }
  select(_p?: unknown) {
    return new SelectBuilder(this);
  }
  delete(table: { __table: string }) {
    return new DeleteBuilder(this, table.__table);
  }
  update(_t: { __table: string }) {
    return new UpdateBuilder();
  }
}

class InsertBuilder {
  private vals: Record<string, unknown>[] = [];
  private doReturning = false;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  values(v: Record<string, unknown> | Record<string, unknown>[]) {
    this.vals = Array.isArray(v) ? v : [v];
    return this;
  }
  onConflictDoUpdate() {
    return this;
  }
  onConflictDoNothing() {
    return this;
  }
  returning() {
    this.doReturning = true;
    return this;
  }
  private run(): Array<{ id: string }> {
    this.db.rowCounts[this.table] =
      (this.db.rowCounts[this.table] ?? 0) + this.vals.length;
    switch (this.table) {
      case "pages": {
        const url = String(this.vals[0]!.canonicalUrl);
        let id = this.db.pages.get(url);
        if (!id) {
          id = this.db.id("page");
          this.db.pages.set(url, id);
        }
        return [{ id }];
      }
      case "authors":
        return [{ id: this.upsert(this.db.authors, "author") }];
      case "categories":
        return [{ id: this.upsert(this.db.categories, "category") }];
      case "tags":
        return [{ id: this.upsert(this.db.tags, "tag") }];
      case "page_versions": {
        for (const r of this.vals) {
          const pageId = String(r.pageId);
          const arr = this.db.versions.get(pageId) ?? [];
          arr.push({
            versionNumber: Number(r.versionNumber),
            contentHash: String(r.contentHash),
          });
          this.db.versions.set(pageId, arr);
        }
        return [];
      }
      default:
        return [];
    }
  }
  private upsert(store: Map<string, string>, prefix: string): string {
    const slug = String(this.vals[0]!.slug);
    let id = store.get(slug);
    if (!id) {
      id = this.db.id(prefix);
      store.set(slug, id);
    }
    return id;
  }
  then(
    resolve: (rows: Array<{ id: string }> | undefined) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      const rows = this.run();
      return Promise.resolve(resolve(this.doReturning ? rows : undefined));
    } catch (e) {
      return Promise.reject(reject ? reject(e) : e);
    }
  }
}

type EqCond = { __eq: true; col: { __col: string }; val: unknown };

class SelectBuilder {
  private table = "";
  private cond?: EqCond;
  constructor(private db: FakeDb) {}
  from(table: { __table: string }) {
    this.table = table.__table;
    return this;
  }
  where(cond: EqCond) {
    this.cond = cond;
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  private run(): unknown[] {
    if (this.table === "pages") {
      const url = String(this.cond?.val);
      const id = this.db.pages.get(url);
      return id ? [{ id }] : [];
    }
    if (this.table === "page_versions") {
      const pageId = String(this.cond?.val);
      const arr = this.db.versions.get(pageId) ?? [];
      if (!arr.length) return [];
      const latest = arr.reduce((a, b) =>
        b.versionNumber > a.versionNumber ? b : a,
      );
      return [latest];
    }
    return [];
  }
  then(resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (e) {
      return Promise.reject(reject ? reject(e) : e);
    }
  }
}

class DeleteBuilder {
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  where() {
    return this;
  }
  then(resolve: (v: undefined) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(resolve(undefined));
    } catch (e) {
      return Promise.reject(reject ? reject(e) : e);
    }
  }
}

class UpdateBuilder {
  set() {
    return this;
  }
  where() {
    return this;
  }
  then(resolve: (v: undefined) => unknown) {
    return Promise.resolve(resolve(undefined));
  }
}

const fakeDb = new FakeDb();

function table(name: string) {
  return new Proxy(
    { __table: name },
    {
      get(target, prop) {
        if (prop === "__table") return name;
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return { __table: name, __col: String(prop) };
      },
    },
  );
}

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  pagesTable: table("pages"),
  pageVersionsTable: table("page_versions"),
  pageCategoriesTable: table("page_categories"),
  pageTagsTable: table("page_tags"),
  authorsTable: table("authors"),
  categoriesTable: table("categories"),
  tagsTable: table("tags"),
  blocksTable: table("blocks"),
  componentTreeTable: table("component_tree"),
  imagesTable: table("images"),
  faqTable: table("faq"),
  breadcrumbsTable: table("breadcrumbs"),
  jsonldTable: table("jsonld"),
  seoTable: table("seo"),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  desc: (col: unknown) => col,
  eq: (col: { __col: string }, val: unknown) => ({ __eq: true, col, val }),
}));

describe("importExport (round-trip into the DB)", () => {
  beforeEach(() => {
    fakeDb.pages.clear();
    fakeDb.authors.clear();
    fakeDb.categories.clear();
    fakeDb.tags.clear();
    fakeDb.versions.clear();
    fakeDb.rowCounts = {};
  });

  function buildExport() {
    const author = mapAuthor(
      {
        id: "a1",
        name: "Aiyana",
        slug: "aiyana",
        bio: "bio",
        avatarUrl: "https://cdn/avatar.jpg",
        role: "Writer",
        email: "a@x.com",
        social: null,
      },
      "media-avatar",
    );
    const parentCat = mapCategory({
      id: "c-root",
      name: "Travel",
      slug: "travel",
      description: null,
      parentId: null,
    });
    const childCat = mapCategory({
      id: "c1",
      name: "Family Travel",
      slug: "family-travel",
      description: "desc",
      parentId: "c-root",
    });
    const tag = mapTag({ id: "t1", name: "Kids", slug: "kids", description: null });
    const post = mapPost(makeBundle(), "media-hero");
    return {
      media: [
        {
          id: "media-hero",
          alt: "Hero",
          caption: null,
          credit: "Headout",
          filename: "hero.jpg",
          mimeType: "image/jpeg",
          filesize: 1234,
          width: 1600,
          height: 900,
          sourceUrl: "https://cdn/hero.jpg",
          url: "https://cdn/hero.jpg",
        },
        {
          id: "media-avatar",
          alt: null,
          caption: null,
          credit: null,
          filename: "avatar.jpg",
          mimeType: "image/jpeg",
          filesize: 99,
          width: 200,
          height: 200,
          sourceUrl: "https://cdn/avatar.jpg",
          url: "https://cdn/avatar.jpg",
        },
      ],
      authors: [author],
      categories: [parentCat, childCat],
      tags: [tag],
      // The post references category "c1" and tag "t1"; make it use both cats.
      posts: [{ ...post, categories: ["c-root", "c1"], tags: ["t1"] }],
    };
  }

  it("imports and is idempotent across re-runs", async () => {
    const { importExport } = await import("../import.js");
    const collections = buildExport();

    const first = await importExport(collections);
    expect(first.authors).toBe(1);
    expect(first.categories).toBe(2);
    expect(first.tags).toBe(1);
    expect(first.postsCreated).toBe(1);
    expect(first.postsUpdated).toBe(0);
    expect(first.postsUnchanged).toBe(0);
    expect(first.media).toBe(1); // hero linked

    // One page, one version after first import.
    expect(fakeDb.pages.size).toBe(1);
    const pageId = [...fakeDb.pages.values()][0]!;
    expect(fakeDb.versions.get(pageId)).toHaveLength(1);

    // Re-import identical content: unchanged, no new page/version.
    const second = await importExport(collections);
    expect(second.postsCreated).toBe(0);
    expect(second.postsUnchanged).toBe(1);
    expect(second.postsUpdated).toBe(0);
    expect(fakeDb.pages.size).toBe(1);
    expect(fakeDb.versions.get(pageId)).toHaveLength(1);
  });

  it("appends a new version when content changes", async () => {
    const { importExport } = await import("../import.js");
    const collections = buildExport();
    await importExport(collections);
    const pageId = [...fakeDb.pages.values()][0]!;

    // Editor changes the title in Payload.
    collections.posts[0]!.title = "Edited Title";
    const res = await importExport(collections);
    expect(res.postsUpdated).toBe(1);
    expect(res.postsUnchanged).toBe(0);
    expect(fakeDb.versions.get(pageId)).toHaveLength(2);
  });
});
