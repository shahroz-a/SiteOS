import { eq, sql } from "drizzle-orm";
import {
  db,
  crawlQueueTable,
  crawlLogsTable,
  validationReportsTable,
} from "@workspace/db";
import type { FetchResult, ParsedPage } from "./types";

/** Mark a URL as in-progress in the crawl queue (idempotent on url). */
export async function markQueued(
  url: string,
  status: "in_progress" | "pending" = "in_progress",
): Promise<void> {
  await db
    .insert(crawlQueueTable)
    .values({ url, status, startedAt: new Date(), attempts: 1 })
    .onConflictDoUpdate({
      target: crawlQueueTable.url,
      set: {
        status,
        startedAt: new Date(),
        attempts: sql`${crawlQueueTable.attempts} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** Record terminal crawl state for a URL. */
export async function markCrawlResult(
  url: string,
  status: "completed" | "failed" | "skipped",
  lastError: string | null = null,
): Promise<void> {
  await db
    .insert(crawlQueueTable)
    .values({
      url,
      status,
      lastError,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: crawlQueueTable.url,
      set: {
        status,
        lastError,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

/** Enqueue discovered URLs without disturbing ones already tracked. */
export async function enqueueDiscovered(
  urls: string[],
  discoveredFrom: string,
): Promise<void> {
  if (urls.length === 0) return;
  await db
    .insert(crawlQueueTable)
    .values(
      urls.map((url) => ({
        url,
        status: "pending" as const,
        discoveredFrom,
      })),
    )
    .onConflictDoNothing({ target: crawlQueueTable.url });
}

export async function logCrawl(args: {
  url: string;
  pageId?: string | null;
  level?: "debug" | "info" | "warn" | "error";
  httpStatus?: number | null;
  message: string;
  details?: unknown;
  durationMs?: number | null;
}): Promise<void> {
  await db.insert(crawlLogsTable).values({
    url: args.url,
    pageId: args.pageId ?? null,
    level: args.level ?? "info",
    httpStatus: args.httpStatus ?? null,
    message: args.message,
    details: args.details ?? null,
    durationMs: args.durationMs ?? null,
  });
}

/**
 * Run lightweight QA on a parsed page and persist a validation report. Returns
 * the issues found (empty when the page passes cleanly).
 */
export async function recordValidation(
  pageId: string,
  page: ParsedPage,
  fetched: FetchResult,
): Promise<string[]> {
  const issues: string[] = [];
  if (!page.title) issues.push("missing title");
  if (!page.cleanedHtml || page.cleanedHtml.length < 200)
    issues.push("suspiciously short cleaned content");
  if (!page.author) issues.push("missing author");
  if (page.categories.length === 0) issues.push("no categories");
  if (page.images.length === 0) issues.push("no images");
  if (fetched.httpStatus !== 200)
    issues.push(`non-200 status: ${fetched.httpStatus}`);

  const status = issues.length === 0 ? "pass" : issues.length > 2 ? "fail" : "warn";
  // Score: 100 minus 15 per issue, floored at 0.
  const score = Math.max(0, 100 - issues.length * 15);

  // One report per page+type: replace the previous run's report.
  await db
    .delete(validationReportsTable)
    .where(eq(validationReportsTable.pageId, pageId));
  await db.insert(validationReportsTable).values({
    pageId,
    reportType: "import-qa",
    status,
    issues: issues.length ? issues : null,
    score,
  });
  return issues;
}
