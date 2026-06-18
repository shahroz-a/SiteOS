import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, crawlQueueTable, type CrawlQueueItem } from "@workspace/db";
import type { DiscoveredUrl } from "./types";

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
  await db
    .insert(crawlQueueTable)
    .values({ url, priority, discoveredFrom, status: "pending" })
    .onConflictDoNothing({ target: crawlQueueTable.url });
}

/**
 * Recover orphaned work: any item left `in_progress` (e.g. from a crashed run)
 * is reset to `pending` so the crawl resumes cleanly instead of restarting.
 */
export async function recoverStaleInProgress(): Promise<number> {
  const reset = await db
    .update(crawlQueueTable)
    .set({ status: "pending", startedAt: null })
    .where(eq(crawlQueueTable.status, "in_progress"))
    .returning({ id: crawlQueueTable.id });
  return reset.length;
}

/**
 * Atomically claim the next batch of pending work, ordered by priority then
 * age. Uses `FOR UPDATE SKIP LOCKED` semantics so concurrent workers never
 * grab the same row.
 */
export async function claimBatch(limit: number, maxAttempts: number): Promise<CrawlQueueItem[]> {
  const rows = await db.execute<CrawlQueueItem>(sql`
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
  `);
  return rows.rows as CrawlQueueItem[];
}

export async function markCompleted(id: string): Promise<void> {
  await db
    .update(crawlQueueTable)
    .set({ status: "completed", completedAt: new Date(), lastError: null })
    .where(eq(crawlQueueTable.id, id));
}

export async function markFailed(
  id: string,
  error: string,
  maxAttempts: number,
): Promise<void> {
  // Permanently fail once attempts are exhausted; otherwise return to pending.
  await db
    .update(crawlQueueTable)
    .set({
      status: sql`CASE WHEN ${crawlQueueTable.attempts} >= ${maxAttempts} THEN 'failed' ELSE 'pending' END`,
      lastError: error.slice(0, 2000),
    })
    .where(eq(crawlQueueTable.id, id));
}

export async function markSkipped(id: string, reason: string): Promise<void> {
  await db
    .update(crawlQueueTable)
    .set({ status: "skipped", lastError: reason.slice(0, 500), completedAt: new Date() })
    .where(eq(crawlQueueTable.id, id));
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
  const rows = await db
    .select({ status: crawlQueueTable.status, count: sql<number>`count(*)::int` })
    .from(crawlQueueTable)
    .groupBy(crawlQueueTable.status);
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
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crawlQueueTable)
    .where(
      and(
        eq(crawlQueueTable.status, "pending"),
        lte(crawlQueueTable.attempts, maxAttempts - 1),
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
