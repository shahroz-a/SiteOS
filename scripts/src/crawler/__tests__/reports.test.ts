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
