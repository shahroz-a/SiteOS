import { describe, it, expect, vi } from "vitest";
import type { MediaItem } from "@workspace/api-client-react";
import {
  gatherFlaggedWindow,
  buildBulkSuggestSession,
  type GatherListMedia,
  type GatherListResult,
} from "../bulk-alt-gather";

const CEILING = 200;

function mkItem(url: string): MediaItem {
  return { url, altStatus: "missing" } as MediaItem;
}

function urls(items: MediaItem[]): string[] {
  return items.map((it) => it.url);
}

/**
 * A `GatherListMedia` over a fixed corpus split into pages of `pageSize`,
 * wrapped in a spy so each test can assert the params it was paged with.
 */
function pagedCorpus(corpus: string[], pageSize: number) {
  return vi.fn<GatherListMedia>((params) => {
    const totalPages = Math.max(1, Math.ceil(corpus.length / pageSize));
    const start = (params.page - 1) * pageSize;
    const slice = corpus.slice(start, start + pageSize);
    const res: GatherListResult = {
      items: slice.map(mkItem),
      pagination: { totalPages },
    };
    return Promise.resolve(res);
  });
}

describe("gatherFlaggedWindow", () => {
  it("forces onlyIssues on and pages with the fixed gather limit", async () => {
    const listMedia = pagedCorpus(["a", "b", "c"], 100);

    const out = await gatherFlaggedWindow({
      listMedia,
      q: "",
      exclude: new Set(),
    });

    expect(urls(out)).toEqual(["a", "b", "c"]);
    expect(listMedia).toHaveBeenCalledWith({
      q: undefined,
      onlyIssues: true,
      page: 1,
      limit: 100,
    });
  });

  it("passes the search filter through (and only-issues stays forced)", async () => {
    const listMedia = pagedCorpus(["a"], 100);

    await gatherFlaggedWindow({
      listMedia,
      q: "lighthouse",
      exclude: new Set(),
    });

    expect(listMedia).toHaveBeenCalledWith({
      q: "lighthouse",
      onlyIssues: true,
      page: 1,
      limit: 100,
    });
  });

  it("excludes already-handled URLs from the gathered window", async () => {
    const listMedia = pagedCorpus(["a", "b", "c", "d"], 100);

    const out = await gatherFlaggedWindow({
      listMedia,
      q: "",
      exclude: new Set(["a", "c"]),
    });

    expect(urls(out)).toEqual(["b", "d"]);
  });

  it("caps the window at the ceiling and stops paging once full", async () => {
    const all = Array.from({ length: 300 }, (_, i) => `u${i}`);
    const listMedia = pagedCorpus(all, 100);

    const out = await gatherFlaggedWindow({ listMedia, q: "", exclude: new Set() });

    expect(out).toHaveLength(CEILING);
    expect(urls(out)).toEqual(all.slice(0, CEILING));
    // Pages 1 and 2 fill the 200 ceiling; page 3 is never fetched.
    const pages = listMedia.mock.calls.map((c) => c[0].page);
    expect(pages).toEqual([1, 2]);
  });

  it("honors a custom ceiling", async () => {
    const all = Array.from({ length: 300 }, (_, i) => `u${i}`);
    const listMedia = pagedCorpus(all, 100);

    const out = await gatherFlaggedWindow({
      listMedia,
      q: "",
      exclude: new Set(),
      ceiling: 50,
    });

    expect(out).toHaveLength(50);
    // The first page already overflows the custom ceiling — no second fetch.
    expect(listMedia).toHaveBeenCalledTimes(1);
  });

  it("stops at the last page even when below the ceiling", async () => {
    const listMedia = pagedCorpus(["a", "b", "c"], 100);

    const out = await gatherFlaggedWindow({ listMedia, q: "", exclude: new Set() });

    expect(out).toHaveLength(3);
    expect(listMedia).toHaveBeenCalledTimes(1);
  });

  it("pages across multiple requests when exclusions thin each page", async () => {
    // Two pages of 2; exclude one per page → result spans both pages.
    const listMedia = pagedCorpus(["a", "b", "c", "d"], 2);

    const out = await gatherFlaggedWindow({
      listMedia,
      q: "",
      exclude: new Set(["a", "c"]),
    });

    expect(urls(out)).toEqual(["b", "d"]);
    const pages = listMedia.mock.calls.map((c) => c[0].page);
    expect(pages).toEqual([1, 2]);
  });
});

describe("buildBulkSuggestSession", () => {
  it("assembles a session from the first window, the total, and the filter", async () => {
    const listMedia = pagedCorpus(["a", "b", "c"], 100);

    const session = await buildBulkSuggestSession({
      listMedia,
      filter: "",
      skipped: [],
      total: 7,
    });

    expect(session).not.toBeNull();
    expect(urls(session!.items)).toEqual(["a", "b", "c"]);
    expect(session!.total).toBe(7);
    expect(session!.filter).toBe("");
    expect(session!.skipped).toEqual([]);
  });

  it("excludes persisted skips from the window but seeds them into the session", async () => {
    const listMedia = pagedCorpus(["s1", "a", "b"], 100);

    const session = await buildBulkSuggestSession({
      listMedia,
      filter: "",
      skipped: ["s1", "s2"],
      total: 5,
    });

    expect(urls(session!.items)).toEqual(["a", "b"]);
    expect(session!.skipped).toEqual(["s1", "s2"]);
  });

  it("scopes the gather to the snapshot filter", async () => {
    const listMedia = pagedCorpus(["a"], 100);

    const session = await buildBulkSuggestSession({
      listMedia,
      filter: "lighthouse",
      skipped: [],
      total: 1,
    });

    expect(session!.filter).toBe("lighthouse");
    expect(listMedia).toHaveBeenCalledWith(
      expect.objectContaining({ q: "lighthouse", onlyIssues: true }),
    );
  });

  it("returns null when nothing is left to review", async () => {
    // The only still-flagged image is already in the skip set.
    const listMedia = pagedCorpus(["stale"], 100);

    const session = await buildBulkSuggestSession({
      listMedia,
      filter: "",
      skipped: ["stale"],
      total: 1,
    });

    expect(session).toBeNull();
  });

  it("propagates a gather failure to the caller", async () => {
    const listMedia = vi.fn<GatherListMedia>(() =>
      Promise.reject(new Error("network")),
    );

    await expect(
      buildBulkSuggestSession({
        listMedia,
        filter: "",
        skipped: [],
        total: 3,
      }),
    ).rejects.toThrow("network");
  });
});
