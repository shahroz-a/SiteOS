import { db } from "@workspace/db";
import {
  pagesTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  crawlQueueTable,
  auditLogsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

const RECENT_LIMIT = 8;
const ACTIVITY_LIMIT = 12;

type DashboardPost = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  publishedAt: string | null;
  authorName: string | null;
};

type DashboardActivity = {
  id: string;
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

/**
 * Aggregate every metric the operational dashboard needs in one pass. Each
 * query is a single grouped/filtered aggregate (no N+1, no `select *`), and the
 * independent queries are run concurrently so the whole dashboard resolves in a
 * single round-trip's worth of latency even at scale.
 */
export async function buildDashboard() {
  const dbStart = performance.now();

  const [
    pageCounts,
    taxonomy,
    quality,
    crawl,
    storage,
    recentlyEdited,
    recentlyPublished,
    activity,
  ] = await Promise.all([
    pageCountsQuery(),
    taxonomyCountsQuery(),
    qualityCountsQuery(),
    crawlStatsQuery(),
    storageQuery(),
    recentlyEditedQuery(),
    recentlyPublishedQuery(),
    activityQuery(),
  ]);

  const latencyMs = Math.round(performance.now() - dbStart);

  return {
    stats: {
      totalBlogs: pageCounts.total,
      published: pageCounts.published,
      drafts: pageCounts.drafts,
      scheduled: pageCounts.scheduled,
      archived: pageCounts.archived,
      authors: taxonomy.authors,
      categories: taxonomy.categories,
      tags: taxonomy.tags,
      missingSeo: quality.missingSeo,
      brokenLinks: quality.brokenLinks,
      validationErrors: quality.validationErrors,
      publishingQueue: crawl.pending + crawl.inProgress,
      crawl,
      database: {
        status: (latencyMs < 750 ? "healthy" : "degraded") as
          | "healthy"
          | "degraded"
          | "down",
        latencyMs,
      },
      storage: { bytes: storage },
    },
    recentlyEdited,
    recentlyPublished,
    activity,
  };
}

/** All post-status counts in a single grouped aggregate over blog posts. */
async function pageCountsQuery() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${pagesTable.status} = 'published' and (${pagesTable.publishedAt} is null or ${pagesTable.publishedAt} <= now()))::int`,
      drafts: sql<number>`count(*) filter (where ${pagesTable.status} = 'draft')::int`,
      scheduled: sql<number>`count(*) filter (where ${pagesTable.status} = 'published' and ${pagesTable.publishedAt} > now())::int`,
      archived: sql<number>`count(*) filter (where ${pagesTable.status} = 'archived')::int`,
    })
    .from(pagesTable)
    .where(eq(pagesTable.pageType, "post"));

  return {
    total: row?.total ?? 0,
    published: row?.published ?? 0,
    drafts: row?.drafts ?? 0,
    scheduled: row?.scheduled ?? 0,
    archived: row?.archived ?? 0,
  };
}

/** Author / category / tag counts bundled into one query via scalar subselects. */
async function taxonomyCountsQuery() {
  const res = await db.execute<{
    authors: number;
    categories: number;
    tags: number;
  }>(sql`
    select
      (select count(*) from ${authorsTable})::int as authors,
      (select count(*) from ${categoriesTable})::int as categories,
      (select count(*) from ${tagsTable})::int as tags
  `);
  const row = res.rows[0];
  return {
    authors: Number(row?.authors ?? 0),
    categories: Number(row?.categories ?? 0),
    tags: Number(row?.tags ?? 0),
  };
}

/**
 * Content-quality signals: posts missing SEO, unresolved internal links, and
 * posts whose latest validation report failed.
 */
async function qualityCountsQuery() {
  const res = await db.execute<{
    missing_seo: number;
    broken_links: number;
    validation_errors: number;
  }>(sql`
    select
      (
        select count(*)::int from pages p
        where p.page_type = 'post'
          and not exists (
            select 1 from seo s
            where s.page_id = p.id
              and s.meta_title is not null and s.meta_title <> ''
              and s.meta_description is not null and s.meta_description <> ''
          )
      ) as missing_seo,
      (
        select count(*)::int from internal_links il
        where il.target_page_id is null
      ) as broken_links,
      (
        select count(*)::int from (
          select distinct on (page_id) page_id, status
          from validation_reports
          where page_id is not null
          order by page_id, created_at desc
        ) latest
        where latest.status = 'fail'
      ) as validation_errors
  `);
  const row = res.rows[0];
  return {
    missingSeo: Number(row?.missing_seo ?? 0),
    brokenLinks: Number(row?.broken_links ?? 0),
    validationErrors: Number(row?.validation_errors ?? 0),
  };
}

/** Crawl queue breakdown by status plus the last completed crawl time. */
async function crawlStatsQuery() {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${crawlQueueTable.status} = 'pending')::int`,
      inProgress: sql<number>`count(*) filter (where ${crawlQueueTable.status} = 'in_progress')::int`,
      completed: sql<number>`count(*) filter (where ${crawlQueueTable.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${crawlQueueTable.status} = 'failed')::int`,
      skipped: sql<number>`count(*) filter (where ${crawlQueueTable.status} = 'skipped')::int`,
      total: sql<number>`count(*)::int`,
      lastCompletedAt: sql<
        string | null
      >`max(${crawlQueueTable.completedAt})`,
    })
    .from(crawlQueueTable);

  return {
    pending: row?.pending ?? 0,
    inProgress: row?.inProgress ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    skipped: row?.skipped ?? 0,
    total: row?.total ?? 0,
    lastCompletedAt: row?.lastCompletedAt
      ? new Date(row.lastCompletedAt).toISOString()
      : null,
  };
}

/** Total Postgres database size on disk, in bytes. */
async function storageQuery(): Promise<number> {
  const res = await db.execute<{ bytes: string }>(
    sql`select pg_database_size(current_database())::bigint as bytes`,
  );
  return Number(res.rows[0]?.bytes ?? 0);
}

const recentColumns = {
  id: pagesTable.id,
  slug: pagesTable.slug,
  title: pagesTable.title,
  status: pagesTable.status,
  updatedAt: pagesTable.updatedAt,
  publishedAt: pagesTable.publishedAt,
  authorName: authorsTable.name,
};

function toDashboardPost(r: {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  updatedAt: Date;
  publishedAt: Date | null;
  authorName: string | null;
}): DashboardPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    authorName: r.authorName ?? null,
  };
}

async function recentlyEditedQuery(): Promise<DashboardPost[]> {
  const rows = await db
    .select(recentColumns)
    .from(pagesTable)
    .leftJoin(authorsTable, eq(pagesTable.authorId, authorsTable.id))
    .where(eq(pagesTable.pageType, "post"))
    .orderBy(desc(pagesTable.updatedAt))
    .limit(RECENT_LIMIT);
  return rows.map(toDashboardPost);
}

async function recentlyPublishedQuery(): Promise<DashboardPost[]> {
  const rows = await db
    .select(recentColumns)
    .from(pagesTable)
    .leftJoin(authorsTable, eq(pagesTable.authorId, authorsTable.id))
    .where(
      and(
        eq(pagesTable.pageType, "post"),
        eq(pagesTable.status, "published"),
        sql`${pagesTable.publishedAt} is not null and ${pagesTable.publishedAt} <= now()`,
      ),
    )
    .orderBy(desc(pagesTable.publishedAt))
    .limit(RECENT_LIMIT);
  return rows.map(toDashboardPost);
}

/**
 * Content activity feed from the audit trail. Restricted to page/content events
 * so sensitive entries (e.g. user role changes) stay behind the dedicated
 * audit-log surface, which is gated separately on `audit.view`.
 */
async function activityQuery(): Promise<DashboardActivity[]> {
  const rows = await db
    .select({
      id: auditLogsTable.id,
      action: auditLogsTable.action,
      actorEmail: auditLogsTable.actorEmail,
      actorRole: auditLogsTable.actorRole,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.entityType, "page"))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(ACTIVITY_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actorEmail ?? null,
    actorRole: r.actorRole ?? null,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
