/**
 * Offline re-validation.
 *
 * Re-applies the current content-fidelity rules ({@link scoreValidation}) to
 * every stored page WITHOUT re-crawling or re-parsing. It reuses the source /
 * parsed element tallies already captured on each page's latest
 * validation_reports row, combined with the page's current type/url/title, so
 * it is cheap (no HTML re-parse) and consistent with the live crawl path.
 *
 * For every page it appends a fresh validation_reports row reflecting the new
 * status and re-syncs pages.status (fail → draft / held back, otherwise
 * published). Finally it regenerates the migration deliverable reports.
 *
 * Run with: pnpm --filter @workspace/scripts run revalidate
 */
import { desc, inArray } from "drizzle-orm";
import { db, pagesTable, validationReportsTable } from "@workspace/db";
import type { CountSet } from "./crawler/validate";
import { scoreValidation } from "./crawler/validate";
import { runReports } from "./crawler/pipeline";

const ZERO_COUNTS: CountSet = {
  headings: 0,
  paragraphs: 0,
  images: 0,
  links: 0,
  tables: 0,
  lists: 0,
  components: 0,
};

function toCountSet(raw: unknown): CountSet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    headings: num(r.headings),
    paragraphs: num(r.paragraphs),
    images: num(r.images),
    links: num(r.links),
    tables: num(r.tables),
    lists: num(r.lists),
    components: num(r.components),
  };
}

async function chunked<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

export async function revalidateAll(log: (m: string) => void = console.log): Promise<void> {
  // Latest validation row per page → reuse its captured source/parsed tallies.
  const validationRows = await db
    .select({
      pageId: validationReportsTable.pageId,
      issues: validationReportsTable.issues,
    })
    .from(validationReportsTable)
    .orderBy(desc(validationReportsTable.createdAt));
  const latestIssuesByPage = new Map<string, unknown>();
  for (const v of validationRows) {
    if (v.pageId && !latestIssuesByPage.has(v.pageId)) latestIssuesByPage.set(v.pageId, v.issues);
  }

  // Explicit column projection — never select(*) (original_html OOMs the heap).
  const pages = await db
    .select({
      id: pagesTable.id,
      pageType: pagesTable.pageType,
      url: pagesTable.canonicalUrl,
      title: pagesTable.title,
      status: pagesTable.status,
    })
    .from(pagesTable);

  log(`Re-validating ${pages.length} pages…`);

  const reportRows: Array<typeof validationReportsTable.$inferInsert> = [];
  const toDraft: string[] = [];
  const toPublished: string[] = [];
  const byStatus: Record<string, number> = { pass: 0, warn: 0, fail: 0 };

  for (const page of pages) {
    const stored = latestIssuesByPage.get(page.id) as
      | { source?: unknown; parsed?: unknown }
      | undefined;
    const source = stored?.source ? toCountSet(stored.source) : ZERO_COUNTS;
    const parsed = stored?.parsed ? toCountSet(stored.parsed) : ZERO_COUNTS;

    const result = scoreValidation({
      source,
      parsed,
      title: page.title ?? "",
      pageType: page.pageType,
      url: page.url ?? "",
    });
    byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;

    reportRows.push({
      pageId: page.id,
      reportType: "content-fidelity",
      status: result.status,
      issues: { issues: result.issues, source: result.source, parsed: result.parsed },
      score: result.score,
    });

    const desiredStatus = result.status === "fail" ? "draft" : "published";
    if (desiredStatus === "draft" && page.status !== "draft") toDraft.push(page.id);
    if (desiredStatus === "published" && page.status === "draft") toPublished.push(page.id);
  }

  await chunked(reportRows, 500, async (batch) => {
    await db.insert(validationReportsTable).values(batch);
  });
  await chunked(toDraft, 500, async (batch) => {
    await db.update(pagesTable).set({ status: "draft" }).where(inArray(pagesTable.id, batch));
  });
  await chunked(toPublished, 500, async (batch) => {
    await db.update(pagesTable).set({ status: "published" }).where(inArray(pagesTable.id, batch));
  });

  log(
    `Re-validation complete: pass=${byStatus.pass} warn=${byStatus.warn} fail=${byStatus.fail} ` +
      `(→draft ${toDraft.length}, →published ${toPublished.length})`,
  );

  await runReports(log);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  revalidateAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
