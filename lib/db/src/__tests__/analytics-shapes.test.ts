import { describe, it, expect } from "vitest";
import {
  checkAnalyticsReadiness,
  ANALYTICS_TABLES,
  ANALYTICS_INDEXES,
  type SqlExecutor,
} from "../analytics-shapes";

const ALL_TABLES = [...ANALYTICS_TABLES];
const ALL_INDEXES = [...ANALYTICS_INDEXES];

/**
 * Build a fake executor that answers the two queries `checkAnalyticsReadiness`
 * issues in order: first the `pg_class` table lookup, then the `pg_class` index
 * lookup. Each returns rows keyed on `relname`.
 */
function fakeExecutor(opts: {
  presentTables: string[];
  presentIndexes: string[];
}): SqlExecutor {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      if (call === 1) {
        return { rows: opts.presentTables.map((relname) => ({ relname })) };
      }
      return { rows: opts.presentIndexes.map((relname) => ({ relname })) };
    },
  };
}

describe("checkAnalyticsReadiness", () => {
  it("reports ready when every table and index exist", async () => {
    const result = await checkAnalyticsReadiness(
      fakeExecutor({
        presentTables: ALL_TABLES,
        presentIndexes: ALL_INDEXES,
      }),
    );

    expect(result.ready).toBe(true);
    expect(result.missingTables).toEqual([]);
    expect(result.missingIndexes).toEqual([]);
    expect(result.presentTables).toEqual(ALL_TABLES);
    expect(result.expectedIndexCount).toBe(ALL_INDEXES.length);
  });

  it("flags missing tables", async () => {
    const result = await checkAnalyticsReadiness(
      fakeExecutor({
        presentTables: ["page_views"],
        presentIndexes: ALL_INDEXES,
      }),
    );

    expect(result.ready).toBe(false);
    expect(result.presentTables).toEqual(["page_views"]);
    expect(result.missingTables).toEqual([
      "page_view_daily",
      "page_view_referrer_daily",
    ]);
  });

  it("flags missing indexes", async () => {
    const result = await checkAnalyticsReadiness(
      fakeExecutor({
        presentTables: ALL_TABLES,
        presentIndexes: ["page_views_page_idx"],
      }),
    );

    expect(result.ready).toBe(false);
    expect(result.presentIndexes).toEqual(["page_views_page_idx"]);
    expect(result.missingIndexes).toEqual(
      ALL_INDEXES.filter((n) => n !== "page_views_page_idx"),
    );
  });

  it("treats a freshly-wiped DB (no tables, no indexes) as not ready", async () => {
    const result = await checkAnalyticsReadiness(
      fakeExecutor({ presentTables: [], presentIndexes: [] }),
    );

    expect(result.ready).toBe(false);
    expect(result.missingTables).toEqual(ALL_TABLES);
    expect(result.missingIndexes).toEqual(ALL_INDEXES);
  });

  it("declares the analytics tables and indexes it depends on", () => {
    expect(ANALYTICS_TABLES).toEqual([
      "page_views",
      "page_view_daily",
      "page_view_referrer_daily",
    ]);
    expect(ANALYTICS_INDEXES).toEqual([
      "page_views_page_idx",
      "page_views_viewed_at_idx",
      "page_views_slug_idx",
      "page_view_daily_day_idx",
      "page_view_daily_page_idx",
      "page_view_daily_slug_idx",
      "page_view_referrer_daily_day_idx",
    ]);
  });
});
