import { and, desc, eq, sql } from "drizzle-orm";
import { db, pagesTable, pageVersionsTable } from "@workspace/db";
import {
  type CmsPostDetail,
  type Executor,
  serializeCmsPostDetail,
  snapshotToInput,
  updatePost,
} from "./cms-content";

type PageStatus = "draft" | "published" | "archived";

interface VersionAuthor {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  role: string | null;
}

export interface PageVersionSummary {
  versionNumber: number;
  changeSummary: string | null;
  createdAt: string;
  title: string;
  status: PageStatus;
  author: VersionAuthor | null;
}

export interface PageVersionDetail {
  versionNumber: number;
  changeSummary: string | null;
  createdAt: string;
  snapshot: CmsPostDetail;
}

export interface VersionFieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  changes: VersionFieldChange[];
}

/** Lightweight existence check (avoids materializing the full page row). */
export async function pageExists(
  id: string,
  exec: Executor = db,
): Promise<boolean> {
  const [row] = await exec
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.id, id))
    .limit(1);
  return Boolean(row);
}

/**
 * List a page's version snapshots newest-first. Only the metadata needed for
 * the history list is projected out of each (potentially large) snapshot via
 * jsonb operators — the full snapshot body is never loaded here.
 */
export async function listPageVersions(
  pageId: string,
  exec: Executor = db,
): Promise<{ items: PageVersionSummary[]; latestVersion: number | null }> {
  const rows = await exec
    .select({
      versionNumber: pageVersionsTable.versionNumber,
      changeSummary: pageVersionsTable.changeSummary,
      createdAt: pageVersionsTable.createdAt,
      title: sql<string | null>`${pageVersionsTable.snapshot}->>'title'`,
      status: sql<string | null>`${pageVersionsTable.snapshot}->>'status'`,
      author: sql<VersionAuthor | null>`${pageVersionsTable.snapshot}->'author'`,
    })
    .from(pageVersionsTable)
    .where(eq(pageVersionsTable.pageId, pageId))
    .orderBy(desc(pageVersionsTable.versionNumber));

  const items: PageVersionSummary[] = rows.map((r) => ({
    versionNumber: r.versionNumber,
    changeSummary: r.changeSummary,
    createdAt: r.createdAt.toISOString(),
    title: r.title ?? "",
    status: (r.status as PageStatus | null) ?? "draft",
    author: r.author ?? null,
  }));

  return { items, latestVersion: items[0]?.versionNumber ?? null };
}

/** Load a single snapshot (full serialized detail) or null when absent. */
export async function getPageVersionSnapshot(
  pageId: string,
  versionNumber: number,
  exec: Executor = db,
): Promise<PageVersionDetail | null> {
  const [row] = await exec
    .select({
      versionNumber: pageVersionsTable.versionNumber,
      changeSummary: pageVersionsTable.changeSummary,
      createdAt: pageVersionsTable.createdAt,
      snapshot: pageVersionsTable.snapshot,
    })
    .from(pageVersionsTable)
    .where(
      and(
        eq(pageVersionsTable.pageId, pageId),
        eq(pageVersionsTable.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    versionNumber: row.versionNumber,
    changeSummary: row.changeSummary,
    createdAt: row.createdAt.toISOString(),
    snapshot: row.snapshot as CmsPostDetail,
  };
}

// Fields surfaced in a version diff. Each getter returns a normalized,
// JSON-comparable value so equality is a simple structural compare.
interface DiffField {
  field: string;
  label: string;
  get: (d: CmsPostDetail) => unknown;
}

const DIFF_FIELDS: DiffField[] = [
  { field: "title", label: "Title", get: (d) => d.title },
  { field: "slug", label: "Slug", get: (d) => d.slug },
  { field: "status", label: "Status", get: (d) => d.status },
  { field: "subtitle", label: "Subtitle", get: (d) => d.subtitle ?? null },
  { field: "excerpt", label: "Excerpt", get: (d) => d.excerpt ?? null },
  { field: "language", label: "Language", get: (d) => d.language },
  { field: "author", label: "Author", get: (d) => d.author?.name ?? null },
  {
    field: "primaryCategory",
    label: "Primary category",
    get: (d) => d.primaryCategory?.name ?? null,
  },
  {
    field: "categories",
    label: "Categories",
    get: (d) => d.categories.map((c) => c.name),
  },
  { field: "tags", label: "Tags", get: (d) => d.tags.map((t) => t.name) },
  {
    field: "featuredImageUrl",
    label: "Featured image",
    get: (d) => d.featuredImageUrl ?? null,
  },
  {
    field: "featuredImageAlt",
    label: "Featured image alt",
    get: (d) => d.featuredImageAlt ?? null,
  },
  { field: "contentHtml", label: "Content", get: (d) => d.contentHtml ?? null },
  { field: "wordCount", label: "Word count", get: (d) => d.wordCount ?? null },
  {
    field: "readingTimeMinutes",
    label: "Reading time (min)",
    get: (d) => d.readingTimeMinutes ?? null,
  },
  {
    field: "publishedAt",
    label: "Published at",
    get: (d) => d.publishedAt ?? null,
  },
  {
    field: "faq",
    label: "FAQ",
    get: (d) => d.faq.map((f) => ({ question: f.question, answer: f.answer })),
  },
  { field: "images", label: "Images", get: (d) => d.images.map((i) => i.url) },
  {
    field: "seo.metaTitle",
    label: "SEO meta title",
    get: (d) => d.seo?.metaTitle ?? null,
  },
  {
    field: "seo.metaDescription",
    label: "SEO meta description",
    get: (d) => d.seo?.metaDescription ?? null,
  },
  {
    field: "seo.focusKeyword",
    label: "SEO focus keyword",
    get: (d) => d.seo?.focusKeyword ?? null,
  },
  {
    field: "seo.keywords",
    label: "SEO keywords",
    get: (d) => d.seo?.keywords ?? null,
  },
  { field: "seo.robots", label: "SEO robots", get: (d) => d.seo?.robots ?? null },
  {
    field: "internalLinks",
    label: "Internal links",
    get: (d) => d.internalLinks.length,
  },
  {
    field: "externalLinks",
    label: "External links",
    get: (d) => d.externalLinks.length,
  },
];

function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Pure field-level diff between two snapshots. `before` may be null (e.g. when
 * comparing against "nothing"). Returns only the fields that changed.
 */
export function diffSnapshots(
  before: CmsPostDetail | null,
  after: CmsPostDetail,
): VersionFieldChange[] {
  const changes: VersionFieldChange[] = [];
  for (const f of DIFF_FIELDS) {
    const b = before ? f.get(before) : null;
    const a = f.get(after);
    if (!structurallyEqual(b, a)) {
      changes.push({ field: f.field, label: f.label, before: b ?? null, after: a ?? null });
    }
  }
  return changes;
}

/**
 * Compare two versions of the same page. `from` is the base (older) version,
 * `to` the compared (newer) one. Returns null if either version is missing.
 */
export async function compareVersions(
  pageId: string,
  from: number,
  to: number,
  exec: Executor = db,
): Promise<VersionDiff | null> {
  const base = await getPageVersionSnapshot(pageId, from, exec);
  const compared = await getPageVersionSnapshot(pageId, to, exec);
  if (!base || !compared) return null;
  return {
    fromVersion: from,
    toVersion: to,
    changes: diffSnapshots(base.snapshot, compared.snapshot),
  };
}

/**
 * Restore a page to a previous version snapshot. Rewrites the page's content
 * from the snapshot while preserving the CURRENT slug (URL stability), and
 * appends a new version entry — history is never overwritten. Returns the
 * restored detail and the source version, or null if the page/version is
 * missing.
 */
export async function restoreVersion(
  pageId: string,
  versionNumber: number,
): Promise<{ detail: CmsPostDetail; restoredFrom: number } | null> {
  const version = await getPageVersionSnapshot(pageId, versionNumber);
  if (!version) return null;
  const [page] = await db
    .select({ slug: pagesTable.slug })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  if (!page) return null;

  const input = snapshotToInput(version.snapshot);
  input.slug = page.slug; // keep the live slug so the public URL never moves
  input.changeSummary = `Restored from version ${versionNumber}`;

  const detail = await updatePost(pageId, input);
  if (!detail) return null;
  return { detail, restoredFrom: versionNumber };
}

// Re-export so route handlers can 404 on unknown pages cheaply.
export { serializeCmsPostDetail };
