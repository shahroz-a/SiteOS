import { db } from "@workspace/db";
import { pagesTable, pageViewsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const LEADER_LIMIT = 10;

/**
 * Record a single page view. The slug is resolved to a page id server-side so
 * the analytics joins stay clean; unknown slugs are ignored (returns false) to
 * avoid junk rows. Privacy-respecting: only slug, coarse referrer host and a
 * timestamp are stored — never IP, user agent, cookie or visitor id.
 */
export async function recordPageView(
  slug: string,
  referrerHost: string | null,
): Promise<boolean> {
  const trimmed = slug.trim();
  if (!trimmed) return false;

  const [page] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.slug, trimmed))
    .limit(1);

  if (!page) return false;

  await db.insert(pageViewsTable).values({
    pageId: page.id,
    slug: trimmed,
    referrerHost: referrerHost ?? null,
  });
  return true;
}

/**
 * Extract a bare host (e.g. "www.google.com") from a Referer header value.
 * Returns null for same-origin/empty/malformed referrers so we never persist a
 * full URL or query string.
 */
export function refererHost(referer: string | undefined | null): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

type Leader = { slug: string; name: string; views: number };
type TimePoint = { period: string; value: number };
type Referrer = { host: string; views: number };

/**
 * Per-(day, slug) page-view counts unified across BOTH storage tiers: the
 * pre-aggregated `page_view_daily` rollup (completed past days, kept small) and
 * the still-raw `page_views` event log (the current day, plus any not-yet-rolled
 * days if the scheduled job is behind). The rollup job guarantees a given day
 * lives in exactly one tier — it aggregates and deletes a day's raw rows in one
 * transaction — so the `union all` can never double-count. Every analytics
 * aggregate over view counts builds on this so it stays correct and fast no
 * matter how recently the rollup ran.
 */
const COMBINED_VIEWS = sql`
  select day::date as day, page_id, slug, views from page_view_daily
  union all
  select date(viewed_at) as day, page_id, slug, count(*)::int as views
  from page_views
  group by date(viewed_at), page_id, slug
`;

/**
 * Per-post view totals for a single slug — all-time, last 7 days, last 30 days.
 * Unifies the `page_view_daily` rollup and the raw `page_views` log via
 * COMBINED_VIEWS, so totals stay correct after the rollup job retires raw rows
 * (a direct page_views-only count would undercount rolled-up days). Counts key
 * off the immutable `slug` column so they survive renames/deletes; windows are
 * calendar-day based, consistent with the dashboard's last7/last30. Returns
 * zeros for a slug that has never been viewed.
 */
export async function buildPostAnalytics(slug: string) {
  const trimmed = slug.trim();
  const res = await db.execute<{
    total: number;
    last7: number;
    last30: number;
  }>(sql`
    with combined as (${COMBINED_VIEWS})
    select
      coalesce(sum(views), 0)::int as total,
      coalesce(sum(views) filter (where day >= current_date - 6), 0)::int as last7,
      coalesce(sum(views) filter (where day >= current_date - 29), 0)::int as last30
    from combined
    where slug = ${trimmed}
  `);
  const row = res.rows[0];
  return {
    slug: trimmed,
    total: Number(row?.total ?? 0),
    last7Days: Number(row?.last7 ?? 0),
    last30Days: Number(row?.last30 ?? 0),
  };
}

/**
 * Per-(day, host) referrer counts unified across BOTH storage tiers, mirroring
 * `COMBINED_VIEWS`: the durable `page_view_referrer_daily` rollup (completed past
 * days) and the still-raw `page_views` event log (the current day, plus any
 * not-yet-rolled days). A missing referrer normalizes to '' in both tiers so
 * direct/same-origin traffic is countable. The rollup job's one-tier-per-day
 * invariant guarantees the `union all` can never double count.
 */
const COMBINED_REFERRERS = sql`
  select day::date as day, referrer_host, views from page_view_referrer_daily
  union all
  select date(viewed_at) as day, coalesce(referrer_host, '') as referrer_host, count(*)::int as views
  from page_views
  group by date(viewed_at), coalesce(referrer_host, '')
`;

/**
 * Build every content-analytics aggregate in one concurrent pass. Each query is
 * a single targeted aggregate (no N+1, no `select *`); independent queries run
 * via Promise.all so the whole snapshot resolves in roughly one round-trip's
 * latency even at scale.
 */
export async function buildAnalytics() {
  const [
    views,
    topPages,
    topAuthors,
    topCategories,
    topTags,
    topReferrers,
    seo,
    publishingVelocity,
    contentGrowth,
    health,
    maintenance,
  ] = await Promise.all([
    viewsQuery(),
    topPagesQuery(),
    topAuthorsQuery(),
    topCategoriesQuery(),
    topTagsQuery(),
    topReferrersQuery(),
    seoQuery(),
    publishingVelocityQuery(),
    contentGrowthQuery(),
    healthQuery(),
    maintenanceQuery(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    views,
    topPages,
    topAuthors,
    topCategories,
    topTags,
    topReferrers,
    seo,
    publishingVelocity,
    contentGrowth,
    health,
    maintenance,
  };
}

/** Page-view totals plus a gap-filled daily series for the last 30 days. */
async function viewsQuery() {
  const totalsRes = await db.execute<{
    total: number;
    last7: number;
    last30: number;
  }>(sql`
    with combined as (${COMBINED_VIEWS})
    select
      coalesce(sum(views), 0)::int as total,
      coalesce(sum(views) filter (where day >= current_date - 6), 0)::int as last7,
      coalesce(sum(views) filter (where day >= current_date - 29), 0)::int as last30
    from combined
  `);
  const totals = totalsRes.rows[0];

  const dailyRes = await db.execute<{ period: string; value: number }>(sql`
    with combined as (${COMBINED_VIEWS})
    select to_char(d.day, 'YYYY-MM-DD') as period, coalesce(sum(c.views), 0)::int as value
    from generate_series(
      current_date - interval '29 days', current_date, interval '1 day'
    ) d(day)
    left join combined c on c.day = d.day::date
    group by d.day
    order by d.day
  `);

  return {
    total: Number(totals?.total ?? 0),
    last7Days: Number(totals?.last7 ?? 0),
    last30Days: Number(totals?.last30 ?? 0),
    daily: dailyRes.rows.map((r) => ({
      period: r.period,
      value: Number(r.value),
    })),
  };
}

/** Most-viewed pages, joined to their current title. */
async function topPagesQuery(): Promise<Leader[]> {
  const res = await db.execute<{ slug: string; name: string; views: number }>(sql`
    with combined as (${COMBINED_VIEWS})
    select c.slug as slug,
           coalesce(max(p.title), c.slug) as name,
           sum(c.views)::int as views
    from combined c
    left join pages p on p.id = c.page_id
    group by c.slug
    order by views desc
    limit ${LEADER_LIMIT}
  `);
  return res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    views: Number(r.views),
  }));
}

/** Most-viewed authors (sum of their pages' views). */
async function topAuthorsQuery(): Promise<Leader[]> {
  const res = await db.execute<{ slug: string; name: string; views: number }>(sql`
    with combined as (${COMBINED_VIEWS})
    select a.slug as slug, a.name as name, sum(c.views)::int as views
    from combined c
    join pages p on p.id = c.page_id
    join authors a on a.id = p.author_id
    group by a.id, a.slug, a.name
    order by views desc
    limit ${LEADER_LIMIT}
  `);
  return res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    views: Number(r.views),
  }));
}

/** Most-viewed categories (by their pages' primary category). */
async function topCategoriesQuery(): Promise<Leader[]> {
  const res = await db.execute<{ slug: string; name: string; views: number }>(sql`
    with combined as (${COMBINED_VIEWS})
    select cat.slug as slug, cat.name as name, sum(c.views)::int as views
    from combined c
    join pages p on p.id = c.page_id
    join categories cat on cat.id = p.primary_category_id
    group by cat.id, cat.slug, cat.name
    order by views desc
    limit ${LEADER_LIMIT}
  `);
  return res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    views: Number(r.views),
  }));
}

/** Most-viewed tags (via the page<->tag junction). */
async function topTagsQuery(): Promise<Leader[]> {
  const res = await db.execute<{ slug: string; name: string; views: number }>(sql`
    with combined as (${COMBINED_VIEWS})
    select t.slug as slug, t.name as name, sum(c.views)::int as views
    from combined c
    join page_tags pt on pt.page_id = c.page_id
    join tags t on t.id = pt.tag_id
    group by t.id, t.slug, t.name
    order by views desc
    limit ${LEADER_LIMIT}
  `);
  return res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    views: Number(r.views),
  }));
}

/**
 * Top referrer hosts by view count, unioning the durable referrer rollup with
 * the current day's raw events. The empty-string bucket (views with no referrer
 * — direct, same-origin, or app traffic) is returned as `host: ""`; the client
 * decides how to label it. Bounded to the top hosts so the breakdown stays a
 * focused "where readers come from" leaderboard.
 */
async function topReferrersQuery(): Promise<Referrer[]> {
  const res = await db.execute<{ host: string; views: number }>(sql`
    with combined as (${COMBINED_REFERRERS})
    select referrer_host as host, sum(views)::int as views
    from combined
    group by referrer_host
    order by views desc, referrer_host
    limit ${LEADER_LIMIT}
  `);
  return res.rows.map((r) => ({
    host: r.host ?? "",
    views: Number(r.views),
  }));
}

/**
 * SEO completeness: each post scores 20 points for each present-and-nonempty
 * SEO field (meta title, meta description, OG image, focus keyword, canonical),
 * for a 0-100 score. We report the mean, the fully-optimized count (>=80) and
 * the needs-work count (<50).
 */
async function seoQuery() {
  const res = await db.execute<{
    average_score: number;
    fully_optimized: number;
    needs_work: number;
    total: number;
  }>(sql`
    select
      coalesce(round(avg(score)), 0)::int as average_score,
      count(*) filter (where score >= 80)::int as fully_optimized,
      count(*) filter (where score < 50)::int as needs_work,
      count(*)::int as total
    from (
      select
        (case when s.meta_title is not null and s.meta_title <> '' then 20 else 0 end
       + case when s.meta_description is not null and s.meta_description <> '' then 20 else 0 end
       + case when s.og_image is not null and s.og_image <> '' then 20 else 0 end
       + case when s.focus_keyword is not null and s.focus_keyword <> '' then 20 else 0 end
       + case when s.canonical_url is not null and s.canonical_url <> '' then 20 else 0 end) as score
      from pages p
      left join seo s on s.page_id = p.id
      where p.page_type = 'post'
    ) scores
  `);
  const row = res.rows[0];
  return {
    averageScore: Number(row?.average_score ?? 0),
    fullyOptimized: Number(row?.fully_optimized ?? 0),
    needsWork: Number(row?.needs_work ?? 0),
    total: Number(row?.total ?? 0),
  };
}

/** Posts published per month over the last 12 months (gap-filled). */
async function publishingVelocityQuery(): Promise<TimePoint[]> {
  const res = await db.execute<{ period: string; value: number }>(sql`
    select to_char(m.month, 'YYYY-MM') as period, count(p.id)::int as value
    from generate_series(
      date_trunc('month', current_date) - interval '11 months',
      date_trunc('month', current_date),
      interval '1 month'
    ) m(month)
    left join pages p
      on p.page_type = 'post'
      and p.status = 'published'
      and p.published_at >= m.month
      and p.published_at < m.month + interval '1 month'
    group by m.month
    order by m.month
  `);
  return res.rows.map((r) => ({ period: r.period, value: Number(r.value) }));
}

/** Cumulative post count at each month end over the last 12 months. */
async function contentGrowthQuery(): Promise<TimePoint[]> {
  const res = await db.execute<{ period: string; value: number }>(sql`
    select to_char(m.month, 'YYYY-MM') as period,
      (
        select count(*)::int from pages p
        where p.page_type = 'post'
          and p.created_at < m.month + interval '1 month'
      ) as value
    from generate_series(
      date_trunc('month', current_date) - interval '11 months',
      date_trunc('month', current_date),
      interval '1 month'
    ) m(month)
    order by m.month
  `);
  return res.rows.map((r) => ({ period: r.period, value: Number(r.value) }));
}

/** Content-health counters: broken links, validation failures, drafts, scheduled. */
async function healthQuery() {
  const res = await db.execute<{
    broken_links: number;
    validation_failures: number;
    drafts: number;
    scheduled: number;
  }>(sql`
    select
      (select count(*)::int from internal_links il where il.target_page_id is null) as broken_links,
      (
        select count(*)::int from (
          select distinct on (page_id) page_id, status
          from validation_reports
          where page_id is not null
          order by page_id, created_at desc
        ) latest
        where latest.status = 'fail'
      ) as validation_failures,
      (select count(*)::int from pages where page_type = 'post' and status = 'draft') as drafts,
      (
        select count(*)::int from pages
        where page_type = 'post' and status = 'published' and published_at > now()
      ) as scheduled
  `);
  const row = res.rows[0];
  return {
    brokenLinks: Number(row?.broken_links ?? 0),
    validationFailures: Number(row?.validation_failures ?? 0),
    drafts: Number(row?.drafts ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
  };
}

/**
 * Most-recent automated storage-cleanup (page-views rollup) run. Reuses the
 * null-actor `analytics.rollup.auto` audit_logs row the scheduled rollup job
 * already writes (no new producer work) so operators get at-a-glance
 * confirmation the storage-bounding job is firing, right where they look at view
 * data. Returns null when the job has never recorded a run.
 */
async function maintenanceQuery() {
  const res = await db.execute<{
    last_run_at: string;
    rolled_rows: number;
    days: number;
    buckets: number;
    referrer_buckets: number;
    cutoff: string;
  }>(sql`
    select
      created_at as last_run_at,
      coalesce((after->>'rolledRows')::int, 0) as rolled_rows,
      coalesce((after->>'days')::int, 0) as days,
      coalesce((after->>'buckets')::int, 0) as buckets,
      coalesce((after->>'referrerBuckets')::int, 0) as referrer_buckets,
      coalesce(after->>'cutoff', '') as cutoff
    from audit_logs
    where action = 'analytics.rollup.auto'
    order by created_at desc
    limit 1
  `);
  const row = res.rows[0];
  if (!row) return null;
  return {
    lastRunAt: new Date(row.last_run_at).toISOString(),
    rolledRows: Number(row.rolled_rows ?? 0),
    days: Number(row.days ?? 0),
    buckets: Number(row.buckets ?? 0),
    referrerBuckets: Number(row.referrer_buckets ?? 0),
    cutoff: String(row.cutoff ?? ""),
  };
}
