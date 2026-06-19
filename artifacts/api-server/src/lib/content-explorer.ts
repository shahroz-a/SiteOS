import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  pagesTable,
  authorsTable,
  categoriesTable,
  seoTable,
} from "@workspace/db";
import {
  transitionPost,
  requiredPermissionForTransition,
  type PageStatusValue,
} from "./cms-publishing";
import type { Executor } from "./cms-content";
import { hasPermission, type Role } from "@workspace/cms-auth";

export type ExplorerSort =
  | "title"
  | "slug"
  | "status"
  | "modified"
  | "published"
  | "updated"
  | "seo"
  | "validation";

export type ExplorerOrder = "asc" | "desc";

export interface ContentExplorerOpts {
  q?: string;
  status?: PageStatusValue;
  author?: string;
  category?: string;
  sort: ExplorerSort;
  order: ExplorerOrder;
  page: number;
  limit: number;
}

/** A single contributing factor to the SEO completeness score. */
export interface SeoFactor {
  id: string;
  label: string;
  present: boolean;
}

/** A failing validation check from the latest report, for the drill-down. */
export interface ValidationIssue {
  id: string;
  label: string;
  severity: "error" | "warn" | "info";
  message: string;
}

export interface ContentExplorerItemOut {
  id: string;
  slug: string;
  title: string;
  canonicalUrl: string;
  pathname: string;
  status: PageStatusValue;
  author: {
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
    role: string | null;
  } | null;
  primaryCategory: { id: string; name: string; slug: string } | null;
  modifiedAt: string | null;
  publishedAt: string | null;
  scheduledFor: string | null;
  updatedAt: string | null;
  seoScore: number;
  /** Per-field breakdown behind `seoScore` (20 points each), for the drill-down. */
  seoFactors: SeoFactor[];
  validationScore: number | null;
  validationStatus: "pass" | "warn" | "fail" | null;
  /** Failed checks from the latest validation report (empty when none/never run). */
  validationIssues: ValidationIssue[];
}

export interface ContentExplorerResult {
  items: ContentExplorerItemOut[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The five SEO fields that each contribute 20 points to `seoScore`, with the
 * SQL presence test and the human label shown in the explorer drill-down. The
 * score SQL is derived from these so the number and its breakdown can't drift.
 */
const SEO_FACTORS: { id: string; col: string; label: string; presentSql: SQL }[] = [
  { id: "metaTitle", col: "seo_meta_title", label: "Meta title", presentSql: sql`(s.meta_title is not null and s.meta_title <> '')` },
  { id: "metaDescription", col: "seo_meta_description", label: "Meta description", presentSql: sql`(s.meta_description is not null and s.meta_description <> '')` },
  { id: "ogImage", col: "seo_og_image", label: "Social image (og:image)", presentSql: sql`(s.og_image is not null and s.og_image <> '')` },
  { id: "focusKeyword", col: "seo_focus_keyword", label: "Focus keyword", presentSql: sql`(s.focus_keyword is not null and s.focus_keyword <> '')` },
  { id: "canonicalUrl", col: "seo_canonical_url", label: "Canonical URL", presentSql: sql`(s.canonical_url is not null and s.canonical_url <> '')` },
];

/** SQL expression computing the 0-100 SEO completeness score for the joined `seo` row. */
const SEO_SCORE_SQL = sql.join(
  SEO_FACTORS.map((f) => sql`case when ${f.presentSql} then 20 else 0 end`),
  sql` + `,
);

/** One selected boolean column per SEO factor, aliased with its snake_case `col`. */
const SEO_FACTOR_COLUMNS = sql.join(
  SEO_FACTORS.map((f) => sql`${f.presentSql} as ${sql.raw(f.col)}`),
  sql`, `,
);

/** Map the sort key to the underlying SQL ordering expression. */
const SORT_EXPR: Record<ExplorerSort, SQL> = {
  title: sql`p.title`,
  slug: sql`p.slug`,
  status: sql`p.status`,
  modified: sql`p.modified_at`,
  published: sql`p.published_at`,
  updated: sql`p.updated_at`,
  seo: sql`seo_score`,
  validation: sql`validation_score`,
};

type ExplorerRow = {
  id: string;
  slug: string;
  title: string;
  canonical_url: string;
  pathname: string;
  status: PageStatusValue;
  modified_at: Date | string | null;
  published_at: Date | string | null;
  scheduled_for: Date | string | null;
  updated_at: Date | string | null;
  author_id: string | null;
  author_name: string | null;
  author_slug: string | null;
  author_avatar_url: string | null;
  author_role: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  seo_score: number;
  seo_meta_title: boolean;
  seo_meta_description: boolean;
  seo_og_image: boolean;
  seo_focus_keyword: boolean;
  seo_canonical_url: boolean;
  validation_score: number | null;
  validation_status: "pass" | "warn" | "fail" | null;
  validation_issues: unknown;
}

/** A SEO-validation check stored inside a `seo` report's `issues.checks`. */
type StoredSeoCheck = {
  id?: unknown;
  label?: unknown;
  severity?: unknown;
  message?: unknown;
  passed?: unknown;
};

/** A content-fidelity diff stored inside a `content-fidelity` report's `issues.issues`. */
type StoredFidelityIssue = {
  field?: unknown;
  severity?: unknown;
  message?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Capitalize a content-fidelity field name (e.g. "headings" → "Headings"). */
function humanizeField(field: string): string {
  if (!field) return "Content";
  return field.charAt(0).toUpperCase() + field.slice(1);
}

/** Map any stored severity onto the explorer's error/warn/info scale. */
function normalizeSeverity(raw: unknown): ValidationIssue["severity"] {
  if (raw === "error" || raw === "fail") return "error";
  if (raw === "warn") return "warn";
  if (raw === "info") return "info";
  return "info";
}

/**
 * Extract the failing issues from a stored validation report's `issues` blob.
 * Handles BOTH report shapes the explorer can surface: `seo` reports (failed
 * `issues.checks`) and `content-fidelity` reports (every `issues.issues` entry
 * is a problem). Returns an empty list for clean or unrecognized reports.
 */
export function extractValidationIssues(raw: unknown): ValidationIssue[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { checks?: unknown; issues?: unknown };

  // SEO validation report — surface the checks that did not pass.
  if (Array.isArray(obj.checks)) {
    const out: ValidationIssue[] = [];
    for (const c of obj.checks as StoredSeoCheck[]) {
      if (c?.passed === true) continue;
      out.push({
        id: str(c?.id),
        label: str(c?.label),
        severity: normalizeSeverity(c?.severity),
        message: str(c?.message),
      });
    }
    return out;
  }

  // Content-fidelity report — every recorded issue is already a problem.
  if (Array.isArray(obj.issues)) {
    return (obj.issues as StoredFidelityIssue[]).map((i) => {
      const field = str(i?.field);
      return {
        id: field,
        label: humanizeField(field),
        severity: normalizeSeverity(i?.severity),
        message: str(i?.message),
      };
    });
  }

  return [];
}

function toIso(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * Server-side paginated/sortable/filterable article list for the content
 * explorer. Computes the SEO completeness score inline and joins the latest
 * validation report per page (via DISTINCT ON) so both scores are sortable in
 * SQL — keeping the table fast with tens of thousands of rows. Restricted to
 * `page_type = 'post'` across every status; never selects the lossless HTML
 * blobs.
 */
export async function listContentExplorer(
  opts: ContentExplorerOpts,
  exec: Executor = db,
): Promise<ContentExplorerResult> {
  const conditions: SQL[] = [sql`p.page_type = 'post'`];
  if (opts.status) conditions.push(sql`p.status = ${opts.status}`);
  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(sql`(p.title ilike ${pattern} or p.slug ilike ${pattern})`);
  }
  if (opts.author?.trim()) conditions.push(sql`a.slug = ${opts.author.trim()}`);
  if (opts.category?.trim()) {
    conditions.push(sql`c.slug = ${opts.category.trim()}`);
  }
  const whereSql = sql.join(conditions, sql` and `);

  const joins = sql`
    from pages p
    left join authors a on a.id = p.author_id
    left join categories c on c.id = p.primary_category_id
    left join seo s on s.page_id = p.id
    left join (
      select distinct on (page_id) page_id, score, status, issues
      from validation_reports
      where page_id is not null
      order by page_id, created_at desc
    ) lv on lv.page_id = p.id
  `;

  const countRes = await exec.execute<{ count: number }>(sql`
    select count(*)::int as count ${joins} where ${whereSql}
  `);
  const total = Number(countRes.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / opts.limit));
  const offset = (opts.page - 1) * opts.limit;

  const orderExpr = SORT_EXPR[opts.sort];
  const dir = opts.order === "asc" ? sql`asc` : sql`desc`;

  const res = await exec.execute<ExplorerRow>(sql`
    select
      p.id, p.slug, p.title, p.canonical_url, p.pathname, p.status,
      p.modified_at, p.published_at, p.scheduled_for, p.updated_at,
      a.id as author_id, a.name as author_name, a.slug as author_slug,
      a.avatar_url as author_avatar_url, a.role as author_role,
      c.id as category_id, c.name as category_name, c.slug as category_slug,
      ${SEO_SCORE_SQL} as seo_score,
      ${SEO_FACTOR_COLUMNS},
      lv.score as validation_score,
      lv.status as validation_status,
      lv.issues as validation_issues
    ${joins}
    where ${whereSql}
    order by ${orderExpr} ${dir} nulls last, p.id asc
    limit ${opts.limit} offset ${offset}
  `);

  const items: ContentExplorerItemOut[] = res.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    canonicalUrl: r.canonical_url,
    pathname: r.pathname,
    status: r.status,
    author:
      r.author_id != null
        ? {
            id: r.author_id,
            name: r.author_name ?? "",
            slug: r.author_slug ?? "",
            avatarUrl: r.author_avatar_url ?? null,
            role: r.author_role ?? null,
          }
        : null,
    primaryCategory:
      r.category_id != null
        ? {
            id: r.category_id,
            name: r.category_name ?? "",
            slug: r.category_slug ?? "",
          }
        : null,
    modifiedAt: toIso(r.modified_at),
    publishedAt: toIso(r.published_at),
    scheduledFor: toIso(r.scheduled_for),
    updatedAt: toIso(r.updated_at),
    seoScore: Number(r.seo_score ?? 0),
    seoFactors: [
      { id: "metaTitle", label: "Meta title", present: Boolean(r.seo_meta_title) },
      { id: "metaDescription", label: "Meta description", present: Boolean(r.seo_meta_description) },
      { id: "ogImage", label: "Social image (og:image)", present: Boolean(r.seo_og_image) },
      { id: "focusKeyword", label: "Focus keyword", present: Boolean(r.seo_focus_keyword) },
      { id: "canonicalUrl", label: "Canonical URL", present: Boolean(r.seo_canonical_url) },
    ],
    validationScore: r.validation_score == null ? null : Number(r.validation_score),
    validationStatus: r.validation_status ?? null,
    validationIssues: extractValidationIssues(r.validation_issues),
  }));

  return {
    items,
    pagination: { page: opts.page, limit: opts.limit, total, totalPages },
  };
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export interface BulkActionResult {
  requested: number;
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/** The set of requested ids that are real `post` pages, plus the missing ones. */
async function partitionPostIds(
  ids: string[],
  exec: Executor = db,
): Promise<{ existing: Set<string>; missing: string[] }> {
  if (ids.length === 0) return { existing: new Set(), missing: [] };
  const rows = await exec
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(and(inArray(pagesTable.id, ids), eq(pagesTable.pageType, "post")));
  const existing = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !existing.has(id));
  return { existing, missing };
}

/**
 * Bulk lifecycle transition. Each id goes through the SAME single-article
 * publish workflow (`transitionPost`) so the state machine and scheduling
 * invariants are enforced identically. Per-id permission is enforced against
 * the actor's role; an id the actor cannot transition fails without affecting
 * the others.
 */
export async function bulkTransition(
  ids: string[],
  to: PageStatusValue,
  scheduledFor: Date | null,
  role: Role,
): Promise<BulkActionResult> {
  const result: BulkActionResult = { requested: ids.length, succeeded: [], failed: [] };
  const messages: Record<string, string> = {
    "not-found": "Post not found",
    "invalid-transition": `Cannot move to ${to}`,
    "schedule-required": "A future scheduledFor date is required to schedule",
    "schedule-in-past": "scheduledFor must be in the future",
  };
  for (const id of ids) {
    const [page] = await db
      .select({ status: pagesTable.status })
      .from(pagesTable)
      .where(and(eq(pagesTable.id, id), eq(pagesTable.pageType, "post")))
      .limit(1);
    if (!page) {
      result.failed.push({ id, error: "Post not found" });
      continue;
    }
    const perm = requiredPermissionForTransition(page.status, to);
    if (!hasPermission(role, perm)) {
      result.failed.push({ id, error: `This transition requires ${perm}` });
      continue;
    }
    const r = await transitionPost(id, to, scheduledFor);
    if (r.ok) result.succeeded.push(id);
    else result.failed.push({ id, error: messages[r.error ?? ""] ?? "Invalid transition" });
  }
  return result;
}

/** Bulk set (or clear, when null) the primary category of selected articles. */
export async function bulkSetCategory(
  ids: string[],
  categoryId: string | null,
): Promise<BulkActionResult> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    if (categoryId != null) {
      const [cat] = await tx
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(eq(categoriesTable.id, categoryId))
        .limit(1);
      if (!cat) {
        return {
          requested: ids.length,
          succeeded: [],
          failed: ids.map((id) => ({ id, error: "Target category not found" })),
        };
      }
    }
    const { existing, missing } = await partitionPostIds(ids, tx);
    const existingIds = ids.filter((id) => existing.has(id));
    if (existingIds.length > 0) {
      await tx
        .update(pagesTable)
        .set({ primaryCategoryId: categoryId, modifiedAt: new Date() })
        .where(inArray(pagesTable.id, existingIds));
    }
    return {
      requested: ids.length,
      succeeded: existingIds,
      failed: missing.map((id) => ({ id, error: "Post not found" })),
    };
  });
}

/** Bulk set (or clear, when null) the author of selected articles. */
export async function bulkSetAuthor(
  ids: string[],
  authorId: string | null,
): Promise<BulkActionResult> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    if (authorId != null) {
      const [author] = await tx
        .select({ id: authorsTable.id })
        .from(authorsTable)
        .where(eq(authorsTable.id, authorId))
        .limit(1);
      if (!author) {
        return {
          requested: ids.length,
          succeeded: [],
          failed: ids.map((id) => ({ id, error: "Target author not found" })),
        };
      }
    }
    const { existing, missing } = await partitionPostIds(ids, tx);
    const existingIds = ids.filter((id) => existing.has(id));
    if (existingIds.length > 0) {
      await tx
        .update(pagesTable)
        .set({ authorId, modifiedAt: new Date() })
        .where(inArray(pagesTable.id, existingIds));
    }
    return {
      requested: ids.length,
      succeeded: existingIds,
      failed: missing.map((id) => ({ id, error: "Post not found" })),
    };
  });
}

export interface BulkSeoFields {
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  canonicalUrl?: string;
  ogImage?: string;
  robots?: string;
}

/**
 * Bulk SEO update. Only the provided fields are written to each selected
 * article's `seo` row (created if absent); omitted fields are left untouched.
 */
export async function bulkSetSeo(
  ids: string[],
  fields: BulkSeoFields,
): Promise<BulkActionResult> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    const { existing, missing } = await partitionPostIds(ids, tx);
    const existingIds = ids.filter((id) => existing.has(id));

    const patch: Partial<typeof seoTable.$inferInsert> = {};
    if (fields.metaTitle !== undefined) patch.metaTitle = fields.metaTitle;
    if (fields.metaDescription !== undefined) {
      patch.metaDescription = fields.metaDescription;
    }
    if (fields.focusKeyword !== undefined) patch.focusKeyword = fields.focusKeyword;
    if (fields.canonicalUrl !== undefined) patch.canonicalUrl = fields.canonicalUrl;
    if (fields.ogImage !== undefined) patch.ogImage = fields.ogImage;
    if (fields.robots !== undefined) patch.robots = fields.robots;

    const succeeded: string[] = [];
    if (Object.keys(patch).length > 0) {
      for (const id of existingIds) {
        await tx
          .insert(seoTable)
          .values({ pageId: id, ...patch })
          .onConflictDoUpdate({ target: seoTable.pageId, set: patch });
        // Touch the page so the explorer's "last modified" reflects the change.
        await tx
          .update(pagesTable)
          .set({ modifiedAt: new Date() })
          .where(eq(pagesTable.id, id));
        succeeded.push(id);
      }
    } else {
      // No fields to write — treat each existing id as a no-op success.
      succeeded.push(...existingIds);
    }

    return {
      requested: ids.length,
      succeeded,
      failed: missing.map((id) => ({ id, error: "Post not found" })),
    };
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ContentExportEnvelope {
  filename: string;
  contentType: string;
  content: string;
}

/** Escape a value for inclusion in a CSV cell. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a downloadable export of the selected explorer rows (the explorer
 * columns only — never the lossless HTML blobs). Supports `json` (default) and
 * `csv`. Returns a `{filename, contentType, content}` envelope, matching the
 * CMS import/export convention (no zip dependency).
 */
export async function buildContentExport(
  ids: string[],
  format: "json" | "csv" = "json",
  exec: Executor = db,
): Promise<ContentExportEnvelope> {
  const rows =
    ids.length === 0
      ? []
      : (
          await listContentExplorer(
            {
              sort: "updated",
              order: "desc",
              page: 1,
              limit: ids.length,
            },
            exec,
          )
        ).items;
  // Preserve the caller's selection order and drop any non-post ids.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const selected = ids.map((id) => byId.get(id)).filter((r): r is ContentExplorerItemOut => Boolean(r));

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const header = [
      "id",
      "title",
      "slug",
      "url",
      "author",
      "category",
      "status",
      "modifiedAt",
      "publishedAt",
      "seoScore",
      "validationScore",
      "validationStatus",
    ];
    const lines = [header.join(",")];
    for (const r of selected) {
      lines.push(
        [
          r.id,
          r.title,
          r.slug,
          r.canonicalUrl,
          r.author?.name ?? "",
          r.primaryCategory?.name ?? "",
          r.status,
          r.modifiedAt ?? "",
          r.publishedAt ?? "",
          r.seoScore,
          r.validationScore ?? "",
          r.validationStatus ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return {
      filename: `content-export-${stamp}.csv`,
      contentType: "text/csv",
      content: lines.join("\n"),
    };
  }

  return {
    filename: `content-export-${stamp}.json`,
    contentType: "application/json",
    content: JSON.stringify({ exportedAt: new Date().toISOString(), items: selected }, null, 2),
  };
}
