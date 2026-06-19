import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  makeDbMock,
  makeDrizzleMock,
  type FakeDbControl,
  type Tables,
} from "../../prerender/__tests__/fakeDb";
import type { QueueStats } from "../queue";

/**
 * Focused unit test for `generateReports` (`crawler/reports.ts`), driven against
 * the in-memory fake `@workspace/db`. It pins the shape of the operator-facing
 * `redirect-skipped.json` report: the served/skipped split, the per-reason
 * tallies, and which rows land in `entries`. Every other table is left empty so
 * the test isolates the redirect-skipped grouping (the only report with no test
 * of its own; the rest are indirectly covered by the pure `classifyRedirect`
 * tests). The classification reuses `classifyRedirect`, so this also guards
 * against a future query/schema change silently breaking that visibility.
 */

const tables: Tables = {
  pages: [],
  seo: [],
  jsonld: [],
  categories: [],
  authors: [],
  redirects: [],
  dropped_redirects: [],
  tags: [],
  images: [],
  internal_links: [],
  external_links: [],
  validation_reports: [],
  blocks: [],
};
const control: FakeDbControl = { failTables: new Set() };

vi.mock("@workspace/db", () => makeDbMock(tables, control));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { generateReports } = await import("../reports");

type Row = Record<string, unknown>;

// A temp report dir. `generateReports` resolves its output via
// `path.resolve(cwd, "..", reportDir)`; an absolute reportDir short-circuits
// that resolve so the files land exactly where we read them from.
const REPORT_DIR = mkdtempSync(path.join(os.tmpdir(), "reports-"));

const EMPTY_QUEUE_STATS: QueueStats = {
  pending: 0,
  in_progress: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
};

function setTables(next: Partial<Tables>) {
  for (const key of Object.keys(tables) as (keyof Tables)[]) {
    tables[key] = next[key] ?? [];
  }
}

let redirectSeq = 0;
function redirect(over: Row = {}): Row {
  redirectSeq += 1;
  return {
    id: `redirect-${redirectSeq}`,
    fromPath: "/blog/old-article/",
    toPath: "/blog/new-article/",
    isActive: true,
    ...over,
  };
}

async function readSkipped() {
  const raw = await readFile(path.join(REPORT_DIR, "redirect-skipped.json"), "utf8");
  return JSON.parse(raw) as {
    totalActive: number;
    served: number;
    skipped: number;
    byReason: Record<string, number>;
    entries: Array<{ id: string; fromPath: string; toPath: string; reason: string }>;
  };
}

async function readDropped() {
  const raw = await readFile(path.join(REPORT_DIR, "redirect-dropped.json"), "utf8");
  return JSON.parse(raw) as {
    total: number;
    byReason: Record<string, number>;
    entries: Array<{
      from: string;
      to: string;
      reason: string;
      statusCode: number;
      discoveredOn: string;
    }>;
  };
}

interface ValidationReport {
  total: number;
  byStatus: Record<string, number>;
  failures: Array<{ pageId: string; status: string; url: string | null }>;
}
async function readValidation() {
  const raw = await readFile(path.join(REPORT_DIR, "validation-report.json"), "utf8");
  return JSON.parse(raw) as ValidationReport;
}

interface HeldBackReport {
  total: number;
  articles: Array<{
    id: string;
    slug: string;
    title: string | null;
    url: string | null;
    pageType: string;
    validationStatus: string | null;
    validationScore: number | null;
    issues: Array<{ field: string; severity: string }> | null;
  }>;
}
async function readHeldBack() {
  const raw = await readFile(path.join(REPORT_DIR, "held-back-articles.json"), "utf8");
  return JSON.parse(raw) as HeldBackReport;
}

interface ReadinessReport {
  heldBackArticles: number;
  validationFailures: number;
  queuePending: number;
  queueFailed: number;
  ready: boolean;
  blockingIssues: string[];
}
async function readReadiness() {
  const raw = await readFile(path.join(REPORT_DIR, "migration-readiness.json"), "utf8");
  return JSON.parse(raw) as ReadinessReport;
}

// An article URL that content-fidelity validation applies to (post + under /blog/).
const ARTICLE_URL = "https://www.headout.com/blog/best-things-london/";
// A taxonomy URL the validator exempts (non-article → always re-scores to pass).
const CATEGORY_URL = "https://www.headout.com/blog/category/london/";

// `issues` blob shape the re-scorer reads (`{ source, parsed }`). An empty
// component tree despite source paragraphs is the canonical catastrophic FAIL.
const FAIL_ISSUES = { source: { paragraphs: 5 }, parsed: { components: 0, paragraphs: 0 } };
// Parsed tree matches source → clean PASS (no warn shortfall, no fail).
const PASS_ISSUES = { source: { paragraphs: 5 }, parsed: { components: 6, paragraphs: 5 } };

let pageSeq = 0;
/** A `pages` row (carrying the joined columns the reports project off it). */
function page(over: Row = {}): Row {
  pageSeq += 1;
  return {
    id: `page-${pageSeq}`,
    slug: `slug-${pageSeq}`,
    title: `Title ${pageSeq}`,
    canonicalUrl: ARTICLE_URL,
    pageType: "post",
    status: "published",
    crawledAt: `2026-01-0${pageSeq}T00:00:00.000Z`,
    ...over,
  };
}

let validationSeq = 0;
/**
 * A `validation_reports` row. The fake DB projects the joined `pages` columns
 * (pageType / canonicalUrl / title) straight off this same row, so they live
 * here alongside the validation columns.
 */
function validationRow(over: Row = {}): Row {
  validationSeq += 1;
  return {
    pageId: `page-${validationSeq}`,
    status: "pass",
    score: 100,
    issues: PASS_ISSUES,
    pageType: "post",
    canonicalUrl: ARTICLE_URL,
    title: `Title ${validationSeq}`,
    createdAt: `2026-01-0${validationSeq}T00:00:00.000Z`,
    ...over,
  };
}

beforeEach(() => {
  setTables({});
  control.failTables = new Set();
  redirectSeq = 0;
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(REPORT_DIR, { recursive: true, force: true });
});

describe("generateReports — redirect-skipped.json", () => {
  it("counts served vs each skip reason and lists only unserveable active rows", async () => {
    setTables({
      redirects: [
        // Serveable: on-blog source, on-blog target, no loop.
        redirect({ id: "ok", fromPath: "/blog/old/", toPath: "/blog/new/" }),
        // non-blog-source: old path isn't under /blog/.
        redirect({
          id: "off-blog",
          fromPath: "/london-tickets/",
          toPath: "/blog/new/",
        }),
        // malformed-segment: under /blog/ but carries junk (embedded URL).
        redirect({
          id: "junk",
          fromPath: "/blog/x/google.com/maps/place/@40.7,!4m5",
          toPath: "/blog/new/",
        }),
        // self-redirect: resolved target equals the old path.
        redirect({
          id: "loop",
          fromPath: "/blog/loop/",
          toPath: "/blog/loop/",
        }),
      ],
    });

    const written = await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);
    expect(
      written.some((f) => f.endsWith("redirect-skipped.json")),
    ).toBe(true);

    const report = await readSkipped();
    expect(report.totalActive).toBe(4);
    expect(report.served).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.byReason).toEqual({
      "non-blog-source": 1,
      "malformed-segment": 1,
      "self-redirect": 1,
    });

    const byId = Object.fromEntries(report.entries.map((e) => [e.id, e.reason]));
    expect(byId).toEqual({
      "off-blog": "non-blog-source",
      junk: "malformed-segment",
      loop: "self-redirect",
    });
    // The serveable row never appears in the skipped entries.
    expect(report.entries.some((e) => e.id === "ok")).toBe(false);
  });

  it("tallies multiple rows sharing a skip reason", async () => {
    setTables({
      redirects: [
        redirect({ fromPath: "/off-one/", toPath: "/blog/a/" }),
        redirect({ fromPath: "/off-two/", toPath: "/blog/b/" }),
        redirect({ fromPath: "/off-three/", toPath: "/blog/c/" }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readSkipped();
    expect(report.totalActive).toBe(3);
    expect(report.served).toBe(0);
    expect(report.skipped).toBe(3);
    expect(report.byReason).toEqual({
      "non-blog-source": 3,
      "malformed-segment": 0,
      "self-redirect": 0,
    });
    expect(report.entries).toHaveLength(3);
    expect(report.entries.every((e) => e.reason === "non-blog-source")).toBe(true);
  });

  it("excludes inactive redirects from the skipped report entirely", async () => {
    setTables({
      redirects: [
        // Active + serveable.
        redirect({ id: "active-ok", fromPath: "/blog/keep/", toPath: "/blog/dest/" }),
        // Inactive + would-be-skipped: must not count toward totals or entries.
        redirect({
          id: "inactive-junk",
          fromPath: "/off-blog/",
          toPath: "/blog/dest/",
          isActive: false,
        }),
        // Active + skipped.
        redirect({ id: "active-junk", fromPath: "/off-blog/", toPath: "/blog/dest/" }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readSkipped();
    // Only the two ACTIVE rows are considered.
    expect(report.totalActive).toBe(2);
    expect(report.served).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.byReason).toEqual({
      "non-blog-source": 1,
      "malformed-segment": 0,
      "self-redirect": 0,
    });
    expect(report.entries.map((e) => e.id)).toEqual(["active-junk"]);
  });

  it("emits an all-zero skipped report when every active redirect is serveable", async () => {
    setTables({
      redirects: [
        redirect({ fromPath: "/blog/a-old/", toPath: "/blog/a-new/" }),
        redirect({ fromPath: "/blog/b-old/", toPath: "/blog/b-new/" }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readSkipped();
    expect(report.totalActive).toBe(2);
    expect(report.served).toBe(2);
    expect(report.skipped).toBe(0);
    expect(report.byReason).toEqual({
      "non-blog-source": 0,
      "malformed-segment": 0,
      "self-redirect": 0,
    });
    expect(report.entries).toEqual([]);
  });
});

describe("generateReports — redirect-dropped.json", () => {
  it("joins each dropped hop to its discovering page and tallies by reason", async () => {
    setTables({
      pages: [
        page({ id: "p1", canonicalUrl: "https://www.headout.com/blog/athens/" }),
        page({ id: "p2", canonicalUrl: "https://www.headout.com/blog/rome/" }),
      ],
      // The fake DB treats innerJoin as a no-op and reads every projected column
      // flat off the FROM-table row, so the joined page's `canonicalUrl` lives on
      // each dropped_redirects row here (mirrors how the other join tests work).
      dropped_redirects: [
        {
          id: "d1",
          pageId: "p1",
          fromUrl: "https://www.headout.com/blog/athens/",
          toUrl: "https://maps.google.com/?q=acropolis",
          reason: "foreign-host",
          statusCode: 301,
          canonicalUrl: "https://www.headout.com/blog/athens/",
        },
        {
          id: "d2",
          pageId: "p1",
          fromUrl: "https://www.headout.com/blog/athens/",
          toUrl: "https://www.headout.com/blog/x/introducingathens.com",
          reason: "bare-domain-segment",
          statusCode: 302,
          canonicalUrl: "https://www.headout.com/blog/athens/",
        },
        {
          id: "d3",
          pageId: "p2",
          fromUrl: "https://www.headout.com/blog/rome/",
          toUrl: "https://other.example.com/page",
          reason: "foreign-host",
          statusCode: 301,
          canonicalUrl: "https://www.headout.com/blog/rome/",
        },
      ],
    });

    const written = await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);
    expect(written.some((f) => f.endsWith("redirect-dropped.json"))).toBe(true);

    const report = await readDropped();
    expect(report.total).toBe(3);
    expect(report.byReason).toEqual({
      "foreign-host": 2,
      "bare-domain-segment": 1,
    });
    // Each entry carries the FULL junk URLs plus the page it was found on.
    const d1 = report.entries.find((e) => e.to === "https://maps.google.com/?q=acropolis");
    expect(d1).toMatchObject({
      from: "https://www.headout.com/blog/athens/",
      reason: "foreign-host",
      statusCode: 301,
      discoveredOn: "https://www.headout.com/blog/athens/",
    });
    const d3 = report.entries.find((e) => e.reason === "foreign-host" && e.discoveredOn === "https://www.headout.com/blog/rome/");
    expect(d3?.to).toBe("https://other.example.com/page");
  });

  it("emits an empty dropped report when nothing was dropped", async () => {
    setTables({ pages: [page({ id: "p1" })], dropped_redirects: [] });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readDropped();
    expect(report.total).toBe(0);
    expect(report.byReason).toEqual({});
    expect(report.entries).toEqual([]);
  });
});

describe("generateReports — validation-report.json", () => {
  it("keeps only the latest row per page and re-scores it through the current validator", async () => {
    setTables({
      validation_reports: [
        // p1 has two rows. The OLDER row currently re-scores to FAIL; the NEWER
        // one to PASS. The latest-per-page logic (driven by desc(createdAt))
        // must pick the newer row, so p1 lands in `pass`, not `fail`. Insertion
        // order is deliberately oldest-first to prove the sort, not the order.
        validationRow({
          pageId: "p1",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "fail",
          issues: FAIL_ISSUES,
        }),
        validationRow({
          pageId: "p1",
          createdAt: "2026-02-01T00:00:00.000Z",
          status: "pass",
          issues: PASS_ISSUES,
        }),
        // p2: a single article row that genuinely re-scores to FAIL.
        validationRow({
          pageId: "p2",
          createdAt: "2026-01-15T00:00:00.000Z",
          status: "fail",
          issues: FAIL_ISSUES,
        }),
        // p3: a stale row STORED as fail by an older validator, but it's a
        // taxonomy page the current validator exempts → re-scores to PASS. The
        // stored verdict must NOT be trusted.
        validationRow({
          pageId: "p3",
          createdAt: "2026-01-10T00:00:00.000Z",
          status: "fail",
          pageType: "category",
          canonicalUrl: CATEGORY_URL,
          issues: FAIL_ISSUES,
        }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readValidation();
    // Three distinct pages after latest-per-page de-duplication.
    expect(report.total).toBe(3);
    // p1 (newer pass) + p3 (stale-fail re-scored to pass) = 2 pass; p2 = 1 fail.
    expect(report.byStatus).toEqual({ pass: 2, fail: 1 });
    expect(report.failures.map((f) => f.pageId)).toEqual(["p2"]);
  });
});

describe("generateReports — held-back-articles.json", () => {
  it("lists only draft posts and re-derives each verdict via the current validator", async () => {
    setTables({
      pages: [
        // Draft post WITH a validation row → re-scored verdict shown.
        page({
          id: "draft-fail",
          slug: "draft-fail",
          title: "Draft Fail",
          status: "draft",
          pageType: "post",
          crawledAt: "2026-03-02T00:00:00.000Z",
        }),
        // Draft post WITHOUT a validation row → null verdict fields.
        page({
          id: "draft-novalidation",
          slug: "draft-novalidation",
          title: "Draft No Validation",
          status: "draft",
          pageType: "post",
          crawledAt: "2026-03-01T00:00:00.000Z",
        }),
        // Draft of a non-post type → excluded from the article review queue.
        page({
          id: "draft-category",
          status: "draft",
          pageType: "category",
          canonicalUrl: CATEGORY_URL,
        }),
        // Published post → not held back at all.
        page({ id: "published-post", status: "published", pageType: "post" }),
      ],
      validation_reports: [
        validationRow({
          pageId: "draft-fail",
          status: "fail",
          issues: FAIL_ISSUES,
        }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readHeldBack();
    expect(report.total).toBe(2);
    // Ordered by crawledAt desc: the draft crawled on 03-02 comes first.
    expect(report.articles.map((a) => a.id)).toEqual(["draft-fail", "draft-novalidation"]);

    const failEntry = report.articles.find((a) => a.id === "draft-fail")!;
    expect(failEntry.validationStatus).toBe("fail");
    expect(typeof failEntry.validationScore).toBe("number");
    expect(failEntry.issues?.some((i) => i.severity === "fail")).toBe(true);

    const noValidationEntry = report.articles.find((a) => a.id === "draft-novalidation")!;
    expect(noValidationEntry.validationStatus).toBeNull();
    expect(noValidationEntry.validationScore).toBeNull();
    expect(noValidationEntry.issues).toBeNull();
  });
});

describe("generateReports — migration-readiness.json", () => {
  it("blocks readiness on re-scored validation failures and failed crawl queue rows", async () => {
    setTables({
      pages: [
        page({ id: "d1", status: "draft", pageType: "post" }),
      ],
      validation_reports: [
        // One genuine article failure (re-scores to fail).
        validationRow({ pageId: "p1", status: "fail", issues: FAIL_ISSUES }),
        // One genuine article pass.
        validationRow({ pageId: "p2", status: "pass", issues: PASS_ISSUES }),
      ],
    });

    await generateReports(
      { ...EMPTY_QUEUE_STATS, pending: 2, failed: 3, total: 5 },
      REPORT_DIR,
    );

    const report = await readReadiness();
    expect(report.validationFailures).toBe(1);
    expect(report.heldBackArticles).toBe(1);
    expect(report.queuePending).toBe(2);
    expect(report.queueFailed).toBe(3);
    expect(report.ready).toBe(false);
    expect(report.blockingIssues).toEqual([
      "1 pages failed content-fidelity validation",
      "3 URLs permanently failed to crawl",
    ]);
  });

  it("is ready when no failures remain and the queue is drained (stale fails ignored)", async () => {
    setTables({
      validation_reports: [
        validationRow({ pageId: "p1", status: "pass", issues: PASS_ISSUES }),
        // Stored fail on a taxonomy page → re-scores to pass, so it must NOT
        // flip readiness to false on its own.
        validationRow({
          pageId: "p2",
          status: "fail",
          pageType: "category",
          canonicalUrl: CATEGORY_URL,
          issues: FAIL_ISSUES,
        }),
      ],
    });

    await generateReports(EMPTY_QUEUE_STATS, REPORT_DIR);

    const report = await readReadiness();
    expect(report.validationFailures).toBe(0);
    expect(report.heldBackArticles).toBe(0);
    expect(report.ready).toBe(true);
    expect(report.blockingIssues).toEqual([]);
  });
});
