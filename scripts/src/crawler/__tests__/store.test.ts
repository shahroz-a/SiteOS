import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fake of the Drizzle `db` used by store.ts. It implements just enough
 * of the query-builder chain (insert/select/delete with thenable execution) to
 * exercise the idempotency / change-detection logic without a real database.
 *
 * Tables are identified by a `__table` tag; columns are produced lazily by a
 * Proxy so any `table.column` access yields a `{ __table, __col }` descriptor.
 */
class FakeDb {
  pages = new Map<string, string>(); // canonicalUrl -> pageId
  authors = new Map<string, string>(); // slug -> id
  categories = new Map<string, string>(); // slug -> id
  tags = new Map<string, string>(); // slug -> id
  pageStatus = new Map<string, string>(); // canonicalUrl -> stored publication status
  versions = new Map<string, Array<{ versionNumber: number; contentHash: string }>>();
  insertRowCounts: Record<string, number> = {};
  insertCallCounts: Record<string, number> = {};
  deleteCounts: Record<string, number> = {};
  redirectRows: Array<{ fromPath: string; toPath: string }> = [];
  private seq = 0;

  id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  insert(table: { __table: string }) {
    return new InsertBuilder(this, table.__table);
  }
  select(_proj?: unknown) {
    return new SelectBuilder(this);
  }
  delete(table: { __table: string }) {
    return new DeleteBuilder(this, table.__table);
  }
}

type EqCond = { __eq: true; col: { __col: string }; val: unknown };

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
    this.db.insertCallCounts[this.table] = (this.db.insertCallCounts[this.table] ?? 0) + 1;
    this.db.insertRowCounts[this.table] =
      (this.db.insertRowCounts[this.table] ?? 0) + this.vals.length;
    switch (this.table) {
      case "pages": {
        const url = String(this.vals[0]!.canonicalUrl);
        let id = this.db.pages.get(url);
        if (!id) {
          id = this.db.id("page");
          this.db.pages.set(url, id);
        }
        this.db.pageStatus.set(url, String(this.vals[0]!.status));
        return [{ id }];
      }
      case "authors":
        return [{ id: this.upsertTaxonomy(this.db.authors, "author") }];
      case "categories":
        return [{ id: this.upsertTaxonomy(this.db.categories, "category") }];
      case "tags":
        return [{ id: this.upsertTaxonomy(this.db.tags, "tag") }];
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
      case "redirects": {
        for (const r of this.vals) {
          this.db.redirectRows.push({
            fromPath: String(r.fromPath),
            toPath: String(r.toPath),
          });
        }
        return [];
      }
      default:
        return [];
    }
  }
  private upsertTaxonomy(store: Map<string, string>, prefix: string): string {
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
      const latest = arr.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
      return [{ versionNumber: latest.versionNumber, contentHash: latest.contentHash }];
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
      this.db.deleteCounts[this.table] = (this.db.deleteCounts[this.table] ?? 0) + 1;
      return Promise.resolve(resolve(undefined));
    } catch (e) {
      return Promise.reject(reject ? reject(e) : e);
    }
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

// Mock the database package: store.ts imports `db` and every table from here.
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
  galleriesTable: table("galleries"),
  imagesTable: table("images"),
  videosTable: table("videos"),
  faqTable: table("faq"),
  accordionsTable: table("accordions"),
  breadcrumbsTable: table("breadcrumbs"),
  jsonldTable: table("jsonld"),
  seoTable: table("seo"),
  metadataTable: table("metadata"),
  internalLinksTable: table("internal_links"),
  externalLinksTable: table("external_links"),
  redirectsTable: table("redirects"),
  droppedRedirectsTable: table("dropped_redirects"),
  crawlLogsTable: table("crawl_logs"),
  validationReportsTable: table("validation_reports"),
}));

// Mock drizzle-orm operators so where/order clauses are introspectable.
vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, val: unknown) => ({ __eq: true, col, val }),
  desc: (col: { __col: string }) => ({ __desc: true, col }),
}));

// Imported after the mocks are registered.
const { assemblePage } = await import("../assemble");
const { storePage } = await import("../store");
const { loadFixture, makeFetchResult } = await import("./helpers");

const URL = "https://www.headout.com/blog/idempotency-article/";
const html = loadFixture("sample-article.html").replace(
  "https://www.headout.com/blog/sample-article/",
  URL,
);

function assemble(sourceHtml = html) {
  return assemblePage(makeFetchResult(sourceHtml, URL), null);
}

describe("storePage idempotency", () => {
  beforeEach(() => {
    // Fresh baseline built with current code (see crawler-content-hash-idempotency memory).
    fakeDb.pages.clear();
    fakeDb.authors.clear();
    fakeDb.categories.clear();
    fakeDb.tags.clear();
    fakeDb.pageStatus.clear();
    fakeDb.versions.clear();
    fakeDb.insertRowCounts = {};
    fakeDb.insertCallCounts = {};
    fakeDb.deleteCounts = {};
    fakeDb.redirectRows = [];
  });

  it("creates the page and an initial version on first store", async () => {
    const result = await storePage(assemble());
    expect(result.created).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.versionNumber).toBe(1);
    expect(fakeDb.insertRowCounts.page_versions).toBe(1);
    expect(fakeDb.insertRowCounts.blocks ?? 0).toBeGreaterThan(0);
  });

  it("storing identical content twice yields changed:false, no new version, no child duplication", async () => {
    const first = await storePage(assemble());
    const blocksAfterFirst = fakeDb.insertRowCounts.blocks ?? 0;
    const imagesAfterFirst = fakeDb.insertRowCounts.images ?? 0;

    const second = await storePage(assemble());

    expect(second.created).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.versionNumber).toBe(first.versionNumber);

    // Exactly one version row total — no append on the unchanged re-store.
    expect(fakeDb.insertRowCounts.page_versions).toBe(1);
    expect(fakeDb.versions.get(first.pageId)).toHaveLength(1);

    // No derived child rows were re-inserted (no duplication).
    expect(fakeDb.insertRowCounts.blocks ?? 0).toBe(blocksAfterFirst);
    expect(fakeDb.insertRowCounts.images ?? 0).toBe(imagesAfterFirst);
  });

  it("re-stores idempotently across three identical stores", async () => {
    await storePage(assemble());
    const blocks = fakeDb.insertRowCounts.blocks ?? 0;
    await storePage(assemble());
    const third = await storePage(assemble());
    expect(third.changed).toBe(false);
    expect(third.versionNumber).toBe(1);
    expect(fakeDb.insertRowCounts.blocks ?? 0).toBe(blocks);
    expect(fakeDb.versions.get(third.pageId)).toHaveLength(1);
  });

  it("appends a new version and rebuilds children when content changes", async () => {
    const first = await storePage(assemble());
    const clearsAfterFirst = fakeDb.deleteCounts.blocks ?? 0;

    const mutated = html.replace(
      "<h1>Sample Article Title</h1>",
      "<h1>Updated Article Title</h1>",
    );
    const second = await storePage(assemble(mutated));

    expect(second.changed).toBe(true);
    expect(second.versionNumber).toBe(2);
    expect(fakeDb.insertRowCounts.page_versions).toBe(2);
    expect(fakeDb.versions.get(first.pageId)).toHaveLength(2);
    // Children were cleared again before rebuild.
    expect(fakeDb.deleteCounts.blocks ?? 0).toBeGreaterThan(clearsAfterFirst);
  });
});

describe("storePage publication gating (hold back failed articles)", () => {
  beforeEach(() => {
    fakeDb.pages.clear();
    fakeDb.authors.clear();
    fakeDb.categories.clear();
    fakeDb.tags.clear();
    fakeDb.pageStatus.clear();
    fakeDb.versions.clear();
    fakeDb.insertRowCounts = {};
    fakeDb.insertCallCounts = {};
    fakeDb.deleteCounts = {};
    fakeDb.redirectRows = [];
  });

  it("publishes a page whose validation passed", async () => {
    await storePage(assemble(), { validationStatus: "pass" });
    expect(fakeDb.pageStatus.get(URL)).toBe("published");
  });

  it("publishes a page whose validation only warned", async () => {
    await storePage(assemble(), { validationStatus: "warn" });
    expect(fakeDb.pageStatus.get(URL)).toBe("published");
  });

  it("holds back (draft) a page whose validation failed", async () => {
    await storePage(assemble(), { validationStatus: "fail" });
    expect(fakeDb.pageStatus.get(URL)).toBe("draft");
  });

  it("defaults to published when no validation status is provided", async () => {
    await storePage(assemble());
    expect(fakeDb.pageStatus.get(URL)).toBe("published");
  });
});

describe("storePage redirect recording (only clean, serveable rows)", () => {
  beforeEach(() => {
    fakeDb.pages.clear();
    fakeDb.authors.clear();
    fakeDb.categories.clear();
    fakeDb.tags.clear();
    fakeDb.pageStatus.clear();
    fakeDb.versions.clear();
    fakeDb.insertRowCounts = {};
    fakeDb.insertCallCounts = {};
    fakeDb.deleteCounts = {};
    fakeDb.redirectRows = [];
  });

  const ORIGIN = "https://www.headout.com";
  function assembleWithRedirects(hops: Array<{ from: string; to: string; status: number }>) {
    const fetch = { ...makeFetchResult(html, URL), redirectChain: hops };
    return assemblePage(fetch, null);
  }

  it("stores clean on-blog hops and drops off-blog, junk, and self-redirect hops", async () => {
    await storePage(
      assembleWithRedirects([
        // clean — kept
        { from: `${ORIGIN}/blog/old-name/`, to: `${ORIGIN}/blog/new-name/`, status: 301 },
        // off-blog — dropped (blog can't serve it)
        {
          from: `${ORIGIN}/statue-of-liberty-cruises-c-121/`,
          to: `${ORIGIN}/statue-of-liberty-tickets-c-121/`,
          status: 301,
        },
        // embedded URL junk — dropped
        {
          from: `${ORIGIN}/blog/disneyland-paris-tips/https://www.headout.com/blog/disneyland-paris-hotel/`,
          to: `${ORIGIN}/blog/disneyland-paris-hotel/`,
          status: 301,
        },
        // trailing quote junk — dropped
        {
          from: `${ORIGIN}/blog/best-broadway-shows-january/%22`,
          to: `${ORIGIN}/blog/best-broadway-shows-january/`,
          status: 301,
        },
        // self-redirect after slash-collapse — dropped (would loop)
        { from: `${ORIGIN}/blog/loop//`, to: `${ORIGIN}/blog/loop/`, status: 301 },
      ]),
    );

    expect(fakeDb.redirectRows).toEqual([
      { fromPath: "/blog/old-name/", toPath: "/blog/new-name/" },
    ]);
  });

  it("normalizes accidental repeated slashes into a serveable path", async () => {
    await storePage(
      assembleWithRedirects([
        {
          from: `${ORIGIN}/blog/acropolis-athens//tickets/`,
          to: `${ORIGIN}/blog/acropolis-athens-tickets/`,
          status: 301,
        },
      ]),
    );

    expect(fakeDb.redirectRows).toEqual([
      { fromPath: "/blog/acropolis-athens/tickets/", toPath: "/blog/acropolis-athens-tickets/" },
    ]);
  });
});
