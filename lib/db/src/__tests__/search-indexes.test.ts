import { describe, it, expect } from "vitest";
import {
  checkSearchReadiness,
  TRIGRAM_INDEXES,
  type SqlExecutor,
} from "../search-indexes";

const ALL_INDEX_NAMES = TRIGRAM_INDEXES.map((idx) => idx.name);

/**
 * Build a fake executor that answers the two queries `checkSearchReadiness`
 * issues in order: first the `pg_extension` lookup, then the `pg_class` index
 * lookup.
 */
function fakeExecutor(opts: {
  extensionPresent: boolean;
  presentIndexes: string[];
}): SqlExecutor {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      if (call === 1) {
        return { rows: opts.extensionPresent ? [{ "?column?": 1 }] : [] };
      }
      return {
        rows: opts.presentIndexes.map((relname) => ({ relname })),
      };
    },
  };
}

describe("checkSearchReadiness", () => {
  it("reports ready when the extension and every trigram index exist", async () => {
    const result = await checkSearchReadiness(
      fakeExecutor({ extensionPresent: true, presentIndexes: ALL_INDEX_NAMES }),
    );

    expect(result.ready).toBe(true);
    expect(result.extensionPresent).toBe(true);
    expect(result.missingIndexes).toEqual([]);
    expect(result.presentIndexes).toHaveLength(TRIGRAM_INDEXES.length);
    expect(result.expectedIndexCount).toBe(TRIGRAM_INDEXES.length);
  });

  it("flags a missing pg_trgm extension", async () => {
    const result = await checkSearchReadiness(
      fakeExecutor({ extensionPresent: false, presentIndexes: ALL_INDEX_NAMES }),
    );

    expect(result.ready).toBe(false);
    expect(result.extensionPresent).toBe(false);
    expect(result.missingIndexes).toEqual([]);
  });

  it("lists missing trigram indexes", async () => {
    const present = ALL_INDEX_NAMES.slice(0, ALL_INDEX_NAMES.length - 3);
    const expectedMissing = ALL_INDEX_NAMES.slice(ALL_INDEX_NAMES.length - 3);

    const result = await checkSearchReadiness(
      fakeExecutor({ extensionPresent: true, presentIndexes: present }),
    );

    expect(result.ready).toBe(false);
    expect(result.extensionPresent).toBe(true);
    expect(result.missingIndexes).toEqual(expectedMissing);
    expect(result.presentIndexes).toEqual(present);
  });

  it("treats a freshly-wiped DB (no extension, no indexes) as not ready", async () => {
    const result = await checkSearchReadiness(
      fakeExecutor({ extensionPresent: false, presentIndexes: [] }),
    );

    expect(result.ready).toBe(false);
    expect(result.extensionPresent).toBe(false);
    expect(result.missingIndexes).toEqual(ALL_INDEX_NAMES);
  });

  it("declares exactly 18 trigram indexes", () => {
    expect(TRIGRAM_INDEXES).toHaveLength(18);
  });
});
