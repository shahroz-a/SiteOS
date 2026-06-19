import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, crawlQueueTable, type CrawlQueueItem } from "@workspace/db";
import type { DiscoveredUrl } from "./types";
import { isAssetUrl, isMalformedBlogUrl, stripNul } from "./util";

/**
 * The Supabase session pooler occasionally drops connections mid-query
 * (FATAL XX000 / ECONNRESET / "Connection terminated"). For a long-running
 * drain these are transient and must NOT abort the whole crawl, so retry the
 * affected statement a few times with backoff before giving up.
 */
function isTransientDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code;
  const msg = (e?.message ?? "").toLowerCase();
  // 25006 = "read-only transaction": the pooler transiently routed a write to
  // a read-only/standby connection during a failover; it clears on retry.
  if (code && ["XX000", "08006", "08003", "08000", "57P01", "57P03", "25006", "ECONNRESET", "ETIMEDOUT"].includes(code)) {
    return true;
  }
  return (
    msg.includes("connection terminated") ||
    msg.includes("connection closed") ||
    msg.includes("econnreset") ||
    msg.includes("terminating connection") ||
    msg.includes("server closed the connection") ||
    msg.includes("read-only transaction") ||
    msg.includes("timeout exceeded")
  );
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 7): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Idempotently enqueue discovered URLs. Existing rows are left untouched
 * (their status/attempt history is preserved) so re-running discovery never
 * resets progress. Returns how many new rows were inserted.
 */
export async function enqueueUrls(urls: DiscoveredUrl[]): Promise<number> {
  if (urls.length === 0) return 0;
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    const rows = slice.map((u) => ({
      url: u.url,
      status: "pending" as const,
      priority: u.priority,
      depth: 0,
      discoveredFrom: u.sitemapSource,
    }));
    const result = await db
      .insert(crawlQueueTable)
      .values(rows)
      .onConflictDoNothing({ target: crawlQueueTable.url })
      .returning({ id: crawlQueueTable.id });
    inserted += result.length;
  }
  return inserted;
}

/** Enqueue a single newly-discovered link (e.g. found while parsing a page). */
export async function enqueueOne(
  url: string,
  discoveredFrom: string,
  priority = 10,
): Promise<void> {
  await withRetry(() =>
    db
      .insert(crawlQueueTable)
      .values({ url, priority, discoveredFrom, status: "pending" })
      .onConflictDoNothing({ target: crawlQueueTable.url }),
  );
}

/**
 * Recover orphaned work: any item left `in_progress` (e.g. from a crashed run)
 * is moved out of `in_progress` so the crawl resumes cleanly instead of
 * restarting. Items whose `attempts` already hit `maxAttempts` are marked
 * `failed` (claimBatch requires `attempts < maxAttempts`, so resetting them to
 * `pending` would strand them un-reclaimable); everything else returns to
 * `pending`. The CASE result is `text`, which Postgres won't implicitly assign
 * to the `crawl_status` enum column, so cast it.
 */
export async function recoverStaleInProgress(maxAttempts: number): Promise<number> {
  const reset = await withRetry(() =>
    db
      .update(crawlQueueTable)
      .set({
        status: sql`(CASE WHEN ${crawlQueueTable.attempts} >= ${maxAttempts} THEN 'failed' ELSE 'pending' END)::crawl_status`,
        startedAt: null,
      })
      .where(eq(crawlQueueTable.status, "in_progress"))
      .returning({ id: crawlQueueTable.id }),
  );
  return reset.length;
}

/**
 * Atomically claim the next batch of pending work, ordered by priority then
 * age. Uses `FOR UPDATE SKIP LOCKED` semantics so concurrent workers never
 * grab the same row.
 */
export async function claimBatch(limit: number, maxAttempts: number): Promise<CrawlQueueItem[]> {
  const rows = await withRetry(() =>
    db.execute<CrawlQueueItem>(sql`
    UPDATE ${crawlQueueTable}
    SET status = 'in_progress', started_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM ${crawlQueueTable}
      WHERE status = 'pending' AND attempts < ${maxAttempts}
      ORDER BY priority DESC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `),
  );
  // `db.execute` runs raw SQL, so `RETURNING *` yields the driver's snake_case
  // column names (e.g. `discovered_from`), NOT Drizzle's camelCase select shape.
  // Casting straight to `CrawlQueueItem` is unsound: `item.discoveredFrom` reads
  // back `undefined` even though `discovered_from` is populated (this silently
  // broke the dead-link/frontier skip classification). Map keys to camelCase so
  // the cast is honest.
  return rows.rows.map((row) => snakeRowToCamel<CrawlQueueItem>(row as Record<string, unknown>));
}

/** Convert a raw snake_case driver row into a camelCase object. */
function snakeRowToCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out as T;
}

export async function markCompleted(id: string): Promise<void> {
  await withRetry(() =>
    db
      .update(crawlQueueTable)
      .set({ status: "completed", completedAt: new Date(), lastError: null })
      .where(eq(crawlQueueTable.id, id)),
  );
}

export async function markFailed(
  id: string,
  error: string,
  maxAttempts: number,
): Promise<void> {
  // Permanently fail once attempts are exhausted; otherwise return to pending.
  // The CASE result is `text`, which Postgres won't implicitly assign to the
  // `crawl_status` enum column (unlike a bare string literal), so cast it.
  await withRetry(() =>
    db
      .update(crawlQueueTable)
      .set({
        status: sql`(CASE WHEN ${crawlQueueTable.attempts} >= ${maxAttempts} THEN 'failed' ELSE 'pending' END)::crawl_status`,
        lastError: stripNul(error).slice(0, 2000),
      })
      .where(eq(crawlQueueTable.id, id)),
  );
}

export async function markSkipped(id: string, reason: string): Promise<void> {
  await withRetry(() =>
    db
      .update(crawlQueueTable)
      .set({ status: "skipped", lastError: stripNul(reason).slice(0, 500), completedAt: new Date() })
      .where(eq(crawlQueueTable.id, id)),
  );
}

/**
 * One-pass queue hygiene: any `pending`/`failed` row whose URL is structurally
 * malformed or a non-page asset can never resolve to an article, so mark it
 * `skipped` (by design) instead of leaving it to burn fetch attempts on every
 * crawl. Idempotent — runs at the start of each crawl so the queue self-cleans.
 * Returns the number of rows reclassified.
 */
export async function reclassifyMalformedQueueItems(): Promise<number> {
  const rows = await withRetry(() =>
    db
      .select({ id: crawlQueueTable.id, url: crawlQueueTable.url })
      .from(crawlQueueTable)
      .where(inArray(crawlQueueTable.status, ["pending", "failed"])),
  );
  const deadIds = rows
    .filter((r) => isMalformedBlogUrl(r.url) || isAssetUrl(r.url))
    .map((r) => r.id);
  if (deadIds.length === 0) return 0;
  const CHUNK = 500;
  for (let i = 0; i < deadIds.length; i += CHUNK) {
    const ids = deadIds.slice(i, i + CHUNK);
    await withRetry(() =>
      db
        .update(crawlQueueTable)
        .set({
          status: "skipped",
          lastError: "skipped: malformed/asset URL",
          completedAt: new Date(),
        })
        .where(inArray(crawlQueueTable.id, ids)),
    );
  }
  return deadIds.length;
}

/**
 * Make permanently-`failed` rows reclaimable again by resetting them to
 * `pending` with a cleared attempt count. `claimBatch` only claims rows with
 * `attempts < maxAttempts`, so a row that exhausted its attempts under an older
 * (stricter) classification — before, e.g., the dead-link / off-blog / malformed
 * skip rules existed — is stranded as `failed` and can never be re-evaluated.
 * Run this once after improving the pipeline's skip logic so the next crawl
 * re-classifies those rows correctly. Returns the number of rows reset.
 */
export async function resetFailedToPending(): Promise<number> {
  const rows = await withRetry(() =>
    db
      .update(crawlQueueTable)
      .set({ status: "pending", attempts: 0, startedAt: null, lastError: null })
      .where(eq(crawlQueueTable.status, "failed"))
      .returning({ id: crawlQueueTable.id }),
  );
  return rows.length;
}

export interface QueueStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
}

export async function queueStats(): Promise<QueueStats> {
  const rows = await withRetry(() =>
    db
      .select({ status: crawlQueueTable.status, count: sql<number>`count(*)::int` })
      .from(crawlQueueTable)
      .groupBy(crawlQueueTable.status),
  );
  const stats: QueueStats = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  for (const r of rows) {
    stats[r.status as keyof Omit<QueueStats, "total">] = r.count;
    stats.total += r.count;
  }
  return stats;
}

/** True when there is no claimable work left (respecting the attempt ceiling). */
export async function hasPendingWork(maxAttempts: number): Promise<boolean> {
  const [row] = await withRetry(() =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(crawlQueueTable)
      .where(
        and(
          eq(crawlQueueTable.status, "pending"),
          lte(crawlQueueTable.attempts, maxAttempts - 1),
        ),
      ),
  );
  return (row?.count ?? 0) > 0;
}

export async function resetQueue(): Promise<void> {
  await db.delete(crawlQueueTable);
}

export async function statusesFor(urls: string[]): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const rows = await db
    .select({ url: crawlQueueTable.url, status: crawlQueueTable.status })
    .from(crawlQueueTable)
    .where(inArray(crawlQueueTable.url, urls));
  return new Map(rows.map((r) => [r.url, r.status]));
}
