/**
 * Real-data integration test for the media library list logic (`listMedia`).
 *
 * The in-memory fake DB used by the route tests can't run the raw, grouped
 * `db.execute` SQL that `listMedia` relies on, so the unit/route coverage is
 * limited to the pure `altIssueMessages` helper and RBAC gating. This test
 * exercises the REAL grouped-by-URL query, usage/page counts, the referencing
 * -page slice and the alt-status classification against the LIVE migration
 * database.
 *
 * It is OPT-IN. Because it touches the real database (read-only), it only runs
 * when `VERIFY_REAL_DATA=1` is set, so the normal test / validation suite skips
 * it (avoiding flakiness and pooler pressure). Run it on demand with:
 *
 *   pnpm --filter @workspace/api-server run verify:media
 *
 * It is read-only by construction: every query is a SELECT. The independent JS
 * oracle (`classifyAlt`, raw-row aggregation) mirrors the SQL rules so the
 * assertions catch any drift between the documented behaviour and the query.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { listMedia, type MediaAltStatus } from "../media.js";

const RUN = process.env.VERIFY_REAL_DATA === "1";

// --- Independent JS oracle mirroring `altStatusCaseSql` in lib/media.ts. ----
// Kept deliberately separate from the production source so the test fails if
// the SQL classification drifts from the documented rules.
const MIN_ALT_LENGTH = 10;
const GENERIC_ALT_WORDS = new Set([
  "image",
  "photo",
  "picture",
  "img",
  "untitled",
  "logo",
  "icon",
  "banner",
  "thumbnail",
  "image1",
  "photo1",
]);
const FILENAME_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/;

/** Mirror Postgres `btrim` (default: strips spaces only, not all whitespace). */
function btrim(s: string): string {
  return s.replace(/^ +/, "").replace(/ +$/, "");
}

/** Independent re-implementation of the SQL alt-status CASE expression. */
function classifyAlt(alt: string | null): MediaAltStatus {
  if (alt == null) return "missing";
  const trimmed = btrim(alt);
  if (trimmed === "") return "missing";
  const lower = trimmed.toLowerCase();
  // char_length counts code points; Array.from matches that for astral chars.
  const len = Array.from(trimmed).length;
  if (len < MIN_ALT_LENGTH || GENERIC_ALT_WORDS.has(lower) || FILENAME_RE.test(lower)) {
    return "poor";
  }
  return "ok";
}

/** Raw aggregate for a single URL, computed in JS straight from `images`. */
interface RawAgg {
  usageCount: number;
  pageIds: Set<string>;
  /** Distinct page rows referencing this URL. */
  pages: Map<
    string,
    { id: string; slug: string; title: string; status: string; pathname: string }
  >;
  /** Max code-point length of any alt for this URL. */
  maxAltLen: number;
  /** Every alt value stored for this URL (for membership checks). */
  alts: Array<string | null>;
}

const MAX_PAGES_PER_ITEM = 100;

describe.runIf(RUN)("listMedia against real data", () => {
  // distinct-URL count = number of media items the library should expose.
  let distinctUrls = 0;
  // The top media items the library returns (deterministic: usage DESC, url ASC).
  let topItems: Awaited<ReturnType<typeof listMedia>>["items"] = [];
  let summary: Awaited<ReturnType<typeof listMedia>>["summary"];
  // Raw oracle aggregates keyed by url, for the sampled top URLs only.
  const oracle = new Map<string, RawAgg>();

  beforeAll(async () => {
    const distinctRes = await db.execute(
      sql`SELECT count(DISTINCT url)::int AS n FROM images`,
    );
    distinctUrls = Number(
      (distinctRes.rows[0] as Record<string, unknown>).n ?? 0,
    );
    expect(distinctUrls).toBeGreaterThan(0);

    // Fetch the top page of the real library (busiest URLs first). These are a
    // deterministic, "known" sample we can verify exactly.
    const top = await listMedia({ page: 1, limit: 25, onlyIssues: false });
    topItems = top.items;
    summary = top.summary;
    expect(topItems.length).toBeGreaterThan(0);

    // Build an independent oracle for exactly the sampled URLs by reading the
    // raw `images` rows (joined to pages) — no reuse of the grouped CTE / CASE.
    const sampleUrls = topItems.map((i) => i.url);
    const rawRows = await db.execute(sql`
      SELECT i.url AS url, i.alt AS alt, i.page_id AS page_id,
             p.slug AS slug, p.title AS title, p.status AS status, p.pathname AS pathname
      FROM images i
      JOIN pages p ON p.id = i.page_id
      WHERE i.url IN (${sql.join(
        sampleUrls.map((u) => sql`${u}`),
        sql`, `,
      )})
    `);
    for (const r of rawRows.rows as Record<string, unknown>[]) {
      const url = String(r.url);
      let agg = oracle.get(url);
      if (!agg) {
        agg = {
          usageCount: 0,
          pageIds: new Set(),
          pages: new Map(),
          maxAltLen: 0,
          alts: [],
        };
        oracle.set(url, agg);
      }
      agg.usageCount += 1;
      const pageId = String(r.page_id);
      agg.pageIds.add(pageId);
      if (!agg.pages.has(pageId)) {
        agg.pages.set(pageId, {
          id: pageId,
          slug: String(r.slug ?? ""),
          title: String(r.title ?? ""),
          status: String(r.status ?? ""),
          pathname: String(r.pathname ?? ""),
        });
      }
      const alt = r.alt == null ? null : String(r.alt);
      agg.alts.push(alt);
      agg.maxAltLen = Math.max(agg.maxAltLen, Array.from(btrim(alt ?? "")).length);
    }
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  }, 30_000);

  it("dedups by URL: every returned item is a unique CDN URL and the summary counts distinct URLs", () => {
    const urls = topItems.map((i) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(summary.totalImages).toBe(distinctUrls);
    // withAltIssues is a strict subset of the library, and real data has both.
    expect(summary.withAltIssues).toBeGreaterThan(0);
    expect(summary.withAltIssues).toBeLessThan(summary.totalImages);
  });

  it("reports usage and page counts that match the raw images table", () => {
    for (const item of topItems) {
      const agg = oracle.get(item.url);
      expect(agg, `oracle for ${item.url}`).toBeDefined();
      expect(item.usageCount, `usageCount for ${item.url}`).toBe(agg!.usageCount);
      expect(item.pageCount, `pageCount for ${item.url}`).toBe(agg!.pageIds.size);
      // The list is ordered most-used first.
      expect(item.usageCount).toBeGreaterThan(0);
    }
    // Confirm the DESC ordering invariant across the sample.
    for (let i = 1; i < topItems.length; i++) {
      expect(topItems[i - 1].usageCount).toBeGreaterThanOrEqual(
        topItems[i].usageCount,
      );
    }
  });

  it("classifies alt text exactly as the independent JS oracle for every returned item", () => {
    const seen = new Set<MediaAltStatus>();
    for (const item of topItems) {
      // The SQL classifies the alt it itself selected; feeding that same value
      // to the JS oracle makes this comparison immune to representative-alt
      // tie-breaking while still proving the rules agree.
      expect(classifyAlt(item.alt), `altStatus for ${item.url}`).toBe(
        item.altStatus,
      );
      // The chosen alt must be one of the URL's stored alts and a longest one.
      const agg = oracle.get(item.url)!;
      const altLen = Array.from(btrim(item.alt ?? "")).length;
      if (item.alt != null) {
        expect(agg.alts).toContain(item.alt);
      }
      expect(altLen).toBe(agg.maxAltLen);
      // altIssues must be empty iff status is ok.
      expect(item.altIssues.length === 0).toBe(item.altStatus === "ok");
      seen.add(item.altStatus);
    }
    // Sanity: classification is not trivially constant across real data.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns the referencing pages for each media item (capped, deduped)", () => {
    for (const item of topItems) {
      const agg = oracle.get(item.url)!;
      const expectedLen = Math.min(agg.pageIds.size, MAX_PAGES_PER_ITEM);
      expect(item.pages.length, `pages length for ${item.url}`).toBe(expectedLen);
      // Page ids are unique within an item and are a subset of the real refs.
      const pageIds = item.pages.map((p) => p.id);
      expect(new Set(pageIds).size).toBe(pageIds.length);
      for (const p of item.pages) {
        expect(agg.pages.has(p.id), `page ${p.id} references ${item.url}`).toBe(
          true,
        );
        const expected = agg.pages.get(p.id)!;
        expect(p.slug).toBe(expected.slug);
        expect(p.pathname).toBe(expected.pathname);
        expect(p.status).toBe(expected.status);
        // Each referencing page carries a valid alt classification too.
        expect(classifyAlt(p.alt)).toBe(p.altStatus);
      }
    }
  });

  it("onlyIssues filter returns only non-ok items and matches the summary total", async () => {
    const issues = await listMedia({ page: 1, limit: 50, onlyIssues: true });
    expect(issues.total).toBe(summary.withAltIssues);
    expect(issues.items.length).toBeGreaterThan(0);
    const issueStatuses = new Set<MediaAltStatus>();
    for (const item of issues.items) {
      expect(item.altStatus).not.toBe("ok");
      expect(classifyAlt(item.alt)).toBe(item.altStatus);
      expect(item.altIssues.length).toBeGreaterThan(0);
      issueStatuses.add(item.altStatus);
    }
    // Real data has both kinds of issue; the filter surfaces both.
    expect(issueStatuses.has("missing")).toBe(true);
    expect(issueStatuses.has("poor")).toBe(true);
  });

  it("search filter narrows results to matching url/alt/caption/title", async () => {
    // "gravatar" appears in many author-avatar URLs but not all media.
    const res = await listMedia({
      page: 1,
      limit: 20,
      q: "gravatar",
      onlyIssues: false,
    });
    expect(res.total).toBeGreaterThan(0);
    expect(res.total).toBeLessThan(distinctUrls);
    const needle = "gravatar";
    for (const item of res.items) {
      const haystack = [item.url, item.alt, item.caption, item.title]
        .filter((v): v is string => v != null)
        .join(" ")
        .toLowerCase();
      expect(haystack.includes(needle), `"${needle}" in ${item.url}`).toBe(true);
    }
  });
});
