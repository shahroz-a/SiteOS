import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayloadPostDoc } from "../mapping.js";

// ---------------------------------------------------------------------------
// Internal-link reconnection after a Payload round-trip import.
//
// The export drops each internal link's `targetPageId` (links round-trip by
// `href` only), so on insert every link's target is null. `importExport` runs a
// resolution pass afterward — once all pages exist — that re-matches each link's
// href to a page's canonical URL. This exercises that pass against an in-memory
// fake DB rich enough to store internal links and apply the resolving UPDATE.
// ---------------------------------------------------------------------------

type ColRef = { __table: string; __col: string };
type EqCond = { __op: "eq"; col: ColRef; val: unknown };
type InArrayCond = { __op: "inArray"; col: ColRef; vals: unknown[] };
type Cond = EqCond | InArrayCond;

interface InternalLinkRow {
  id: string;
  pageId: string;
  targetPageId: string | null;
  href: string;
}
interface PageRow {
  id: string;
  canonicalUrl: string;
}
interface VersionRow {
  pageId: string;
  versionNumber: number;
  contentHash: string;
}

class FakeDb {
  pages: PageRow[] = [];
  internalLinks: InternalLinkRow[] = [];
  versions: VersionRow[] = [];
  private slugIds = new Map<string, string>(); // "table:slug" -> id
  private seq = 0;

  id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
  insert(table: { __table: string }) {
    return new InsertBuilder(this, table.__table);
  }
  select(projection?: Record<string, unknown>) {
    return new SelectBuilder(this, projection);
  }
  delete(table: { __table: string }) {
    return new DeleteBuilder(this, table.__table);
  }
  update(table: { __table: string }) {
    return new UpdateBuilder(this, table.__table);
  }
  upsertBySlug(table: string, slug: string): string {
    const key = `${table}:${slug}`;
    let id = this.slugIds.get(key);
    if (!id) {
      id = this.id(table);
      this.slugIds.set(key, id);
    }
    return id;
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
    switch (this.table) {
      case "pages": {
        const url = String(this.vals[0]!.canonicalUrl);
        let row = this.db.pages.find((p) => p.canonicalUrl === url);
        if (!row) {
          row = { id: this.db.id("page"), canonicalUrl: url };
          this.db.pages.push(row);
        }
        return [{ id: row.id }];
      }
      case "authors":
      case "categories":
      case "tags":
        return [{ id: this.db.upsertBySlug(this.table, String(this.vals[0]!.slug)) }];
      case "page_versions": {
        for (const r of this.vals) {
          this.db.versions.push({
            pageId: String(r.pageId),
            versionNumber: Number(r.versionNumber),
            contentHash: String(r.contentHash),
          });
        }
        return [];
      }
      case "internal_links": {
        for (const r of this.vals) {
          this.db.internalLinks.push({
            id: this.db.id("ilink"),
            pageId: String(r.pageId),
            // The importer never sets targetPageId on insert — it starts null.
            targetPageId:
              r.targetPageId == null ? null : String(r.targetPageId),
            href: String(r.href),
          });
        }
        return [];
      }
      default:
        return [];
    }
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

class SelectBuilder {
  private table = "";
  private cond?: Cond;
  constructor(
    private db: FakeDb,
    private _projection?: Record<string, unknown>,
  ) {}
  from(table: { __table: string }) {
    this.table = table.__table;
    return this;
  }
  where(cond: Cond) {
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
      if (this.cond && this.cond.__op === "eq") {
        const col = this.cond.col.__col;
        const val = this.cond.val;
        return this.db.pages.filter(
          (p) => (p as unknown as Record<string, unknown>)[col] === val,
        );
      }
      // No predicate: resolveInternalLinks reads every page.
      return this.db.pages.map((p) => ({ id: p.id, canonicalUrl: p.canonicalUrl }));
    }
    if (this.table === "page_versions") {
      const pageId =
        this.cond && this.cond.__op === "eq" ? String(this.cond.val) : "";
      const rows = this.db.versions.filter((v) => v.pageId === pageId);
      if (!rows.length) return [];
      const latest = rows.reduce((a, b) =>
        b.versionNumber > a.versionNumber ? b : a,
      );
      return [latest];
    }
    if (this.table === "internal_links") {
      // resolveInternalLinks reads every link (id + href).
      return this.db.internalLinks.map((l) => ({ id: l.id, href: l.href }));
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
  private cond?: Cond;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  where(cond: Cond) {
    this.cond = cond;
    return this;
  }
  private run(): void {
    if (this.table === "internal_links" && this.cond?.__op === "eq") {
      const col = this.cond.col.__col;
      const val = this.cond.val;
      this.db.internalLinks = this.db.internalLinks.filter(
        (l) => (l as unknown as Record<string, unknown>)[col] !== val,
      );
    }
  }
  then(resolve: (v: undefined) => unknown, reject?: (e: unknown) => unknown) {
    try {
      this.run();
      return Promise.resolve(resolve(undefined));
    } catch (e) {
      return Promise.reject(reject ? reject(e) : e);
    }
  }
}

class UpdateBuilder {
  private setVals: Record<string, unknown> = {};
  private cond?: Cond;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  set(vals: Record<string, unknown>) {
    this.setVals = vals;
    return this;
  }
  where(cond: Cond) {
    this.cond = cond;
    return this;
  }
  private run(): void {
    if (this.table !== "internal_links") return;
    if (this.cond?.__op !== "inArray") return;
    const ids = new Set(this.cond.vals.map(String));
    for (const l of this.db.internalLinks) {
      if (ids.has(l.id)) {
        l.targetPageId =
          this.setVals.targetPageId == null
            ? null
            : String(this.setVals.targetPageId);
      }
    }
  }
  then(resolve: (v: undefined) => unknown) {
    this.run();
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
  internalLinksTable: table("internal_links"),
  externalLinksTable: table("external_links"),
  metadataTable: table("metadata"),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  desc: (col: unknown) => ({ __op: "desc", col }),
  eq: (col: ColRef, val: unknown) => ({ __op: "eq", col, val }),
  inArray: (col: ColRef, vals: unknown[]) => ({ __op: "inArray", col, vals }),
}));

function makePost(opts: {
  id: string;
  slug: string;
  canonicalUrl: string;
  internal?: PayloadPostDoc["links"]["internal"];
}): PayloadPostDoc {
  return {
    id: opts.id,
    title: `Post ${opts.slug}`,
    slug: opts.slug,
    subtitle: null,
    excerpt: null,
    _status: "published",
    language: "en",
    publishedAt: null,
    author: null,
    categories: [],
    primaryCategory: null,
    tags: [],
    heroImage: null,
    layout: [],
    content: null,
    contentHtml: null,
    meta: {
      title: null,
      description: null,
      image: null,
      canonicalUrl: opts.canonicalUrl,
      robots: null,
      keywords: null,
      ogTitle: null,
      ogDescription: null,
      twitterCard: null,
    },
    url: {
      canonicalUrl: opts.canonicalUrl,
      pathname: new URL(opts.canonicalUrl).pathname,
      parentPath: "/blog/",
    },
    readingTimeMinutes: null,
    wordCount: null,
    breadcrumbs: [],
    faq: [],
    structuredData: [],
    inlineImages: [],
    links: { internal: opts.internal ?? [], external: [] },
    metadata: null,
  };
}

describe("importExport reconnects internal links", () => {
  beforeEach(() => {
    fakeDb.pages = [];
    fakeDb.internalLinks = [];
    fakeDb.versions = [];
  });

  it("resolves a previously-null targetPageId to a matching page", async () => {
    const { importExport } = await import("../import.js");

    const postA = makePost({
      id: "a",
      slug: "a",
      canonicalUrl: "https://site/blog/a/",
      internal: [
        {
          href: "https://site/blog/b/",
          anchorText: "Read B",
          rel: null,
          position: 0,
        },
        {
          href: "https://site/blog/missing/",
          anchorText: "Dangling",
          rel: null,
          position: 1,
        },
      ],
    });
    const postB = makePost({
      id: "b",
      slug: "b",
      canonicalUrl: "https://site/blog/b/",
    });

    const stats = await importExport({
      media: [],
      authors: [],
      categories: [],
      tags: [],
      posts: [postA, postB],
    });

    const pageBId = fakeDb.pages.find(
      (p) => p.canonicalUrl === "https://site/blog/b/",
    )!.id;

    const linkToB = fakeDb.internalLinks.find(
      (l) => l.href === "https://site/blog/b/",
    )!;
    const dangling = fakeDb.internalLinks.find(
      (l) => l.href === "https://site/blog/missing/",
    )!;

    // The link to a known page is reconnected; the dangling one stays null.
    expect(linkToB.targetPageId).toBe(pageBId);
    expect(dangling.targetPageId).toBeNull();
    expect(stats.internalLinksResolved).toBe(1);
  });
});
