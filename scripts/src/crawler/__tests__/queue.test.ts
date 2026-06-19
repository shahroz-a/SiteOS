import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the snake→camel mapping in `claimBatch`. `db.execute(sql`…RETURNING *`)`
 * returns the driver's RAW rows, whose keys are the literal Postgres column
 * names (snake_case, e.g. `discovered_from`, `created_at`, `last_error`) — NOT
 * Drizzle's camelCase select shape. The old code cast those rows straight to
 * `CrawlQueueItem`, so `item.discoveredFrom` read back `undefined` even though
 * `discovered_from` was populated, which silently mislabeled frontier dead-links
 * as hard failures. TypeScript can't catch the unsound cast, so this runtime
 * test is the only guard. It fails if someone reverts `snakeRowToCamel` or
 * reintroduces a raw `RETURNING *` cast.
 *
 * The fake `db.execute` mimics the pg driver: it returns `{ rows }` with
 * snake_case keys, exactly as the real raw query does.
 */

const claimedRawRow = {
  id: "00000000-0000-0000-0000-000000000001",
  url: "https://www.headout.com/blog/some-article/",
  status: "in_progress",
  priority: 10,
  depth: 0,
  discovered_from: "https://www.headout.com/blog/sitemap.xml",
  attempts: 1,
  last_error: "previous transient error",
  scheduled_at: null,
  started_at: new Date("2026-06-19T00:00:00.000Z"),
  completed_at: null,
  created_at: new Date("2026-06-18T00:00:00.000Z"),
  updated_at: new Date("2026-06-19T00:00:00.000Z"),
};

const executeMock = vi.fn(async () => ({ rows: [claimedRawRow] }));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
  crawlQueueTable: { __table: "crawl_queue" },
}));

// `claimBatch` only uses `sql`, but queue.ts imports several operators at the
// top of the module, so every named import must resolve.
vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: true, col, val }),
  inArray: (col: unknown, vals: unknown) => ({ __inArray: true, col, vals }),
  lte: (col: unknown, val: unknown) => ({ __lte: true, col, val }),
}));

const { claimBatch } = await import("../queue");

describe("claimBatch snake_case → camelCase mapping", () => {
  beforeEach(() => {
    executeMock.mockClear();
  });

  it("maps snake_case driver columns to the camelCase CrawlQueueItem shape", async () => {
    const [item] = await claimBatch(1, 3);
    expect(item).toBeDefined();

    // Identical-in-both-cases columns survive a raw cast too — not the regression.
    expect(item!.id).toBe(claimedRawRow.id);
    expect(item!.url).toBe(claimedRawRow.url);
    expect(item!.status).toBe("in_progress");

    // The columns whose camelCase name differs from the DB column. These are the
    // ones a raw `RETURNING *` cast would leave as `undefined`.
    expect(item!.discoveredFrom).toBe(claimedRawRow.discovered_from);
    expect(item!.lastError).toBe(claimedRawRow.last_error);
    expect(item!.startedAt).toEqual(claimedRawRow.started_at);
    expect(item!.createdAt).toEqual(claimedRawRow.created_at);
    expect(item!.updatedAt).toEqual(claimedRawRow.updated_at);
  });

  it("does not leak the original snake_case keys onto the mapped item", async () => {
    const [item] = await claimBatch(1, 3);
    const record = item as unknown as Record<string, unknown>;
    expect(record.discovered_from).toBeUndefined();
    expect(record.last_error).toBeUndefined();
    expect(record.started_at).toBeUndefined();
    expect(record.created_at).toBeUndefined();
  });

  it("returns one mapped item per raw driver row", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        claimedRawRow,
        { ...claimedRawRow, id: "00000000-0000-0000-0000-000000000002", discovered_from: "https://www.headout.com/blog/" },
      ],
    });
    const items = await claimBatch(2, 3);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.discoveredFrom)).toEqual([
      "https://www.headout.com/blog/sitemap.xml",
      "https://www.headout.com/blog/",
    ]);
  });
});
