import { eq } from "drizzle-orm";
import {
  db,
  authorsTable,
  categoriesTable,
  tagsTable,
  pageTagsTable,
  pageCategoriesTable,
  pagesTable,
} from "@workspace/db";
import {
  CreateCmsAuthorBody,
  UpdateCmsAuthorBody,
  CreateCmsCategoryBody,
  UpdateCmsCategoryBody,
  CreateCmsTagBody,
  UpdateCmsTagBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { slugify } from "./cms-content";

export type CmsAuthorInput = z.infer<typeof CreateCmsAuthorBody>;
export type CmsAuthorUpdate = z.infer<typeof UpdateCmsAuthorBody>;
export type CmsCategoryInput = z.infer<typeof CreateCmsCategoryBody>;
export type CmsCategoryUpdate = z.infer<typeof UpdateCmsCategoryBody>;
export type CmsTagInput = z.infer<typeof CreateCmsTagBody>;
export type CmsTagUpdate = z.infer<typeof UpdateCmsTagBody>;

export interface AuthorRow {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  role: string | null;
  email: string | null;
  originalUrl: string | null;
  social: Record<string, string> | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  path: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  postCount: number;
}

/**
 * Produce a slug for a taxonomy term that is unique against `taken`. Falls back
 * to the slugified name; appends `-2`, `-3`, … on collision.
 */
function uniqueTermSlug(
  desired: string | undefined,
  name: string,
  taken: Set<string>,
): string {
  const base = slugify(desired ?? "") || slugify(name) || "term";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function takenSlugs(
  table: typeof authorsTable | typeof categoriesTable | typeof tagsTable,
  excludeId?: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: table.id, slug: table.slug })
    .from(table);
  return new Set(
    rows.filter((r) => r.id !== excludeId).map((r) => r.slug),
  );
}

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

function mapAuthor(a: typeof authorsTable.$inferSelect): AuthorRow {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    bio: a.bio,
    avatarUrl: a.avatarUrl,
    role: a.role,
    email: a.email,
    originalUrl: a.originalUrl,
    social: a.social,
  };
}

export async function createAuthor(input: CmsAuthorInput): Promise<AuthorRow> {
  const taken = await takenSlugs(authorsTable);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .insert(authorsTable)
    .values({
      name: input.name,
      slug,
      bio: input.bio ?? null,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role ?? null,
      email: input.email ?? null,
      originalUrl: input.originalUrl ?? null,
      social: input.social ?? null,
    })
    .returning();
  return mapAuthor(row!);
}

export async function updateAuthor(
  id: string,
  input: CmsAuthorUpdate,
): Promise<AuthorRow | null> {
  const [existing] = await db
    .select({ id: authorsTable.id })
    .from(authorsTable)
    .where(eq(authorsTable.id, id))
    .limit(1);
  if (!existing) return null;
  const taken = await takenSlugs(authorsTable, id);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .update(authorsTable)
    .set({
      name: input.name,
      slug,
      bio: input.bio ?? null,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role ?? null,
      email: input.email ?? null,
      originalUrl: input.originalUrl ?? null,
      social: input.social ?? null,
      updatedAt: new Date(),
    })
    .where(eq(authorsTable.id, id))
    .returning();
  return row ? mapAuthor(row) : null;
}

export async function deleteAuthor(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(authorsTable)
    .where(eq(authorsTable.id, id))
    .returning({ id: authorsTable.id });
  return Boolean(deleted);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function mapCategory(c: typeof categoriesTable.$inferSelect): CategoryRow {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    parentId: c.parentId,
    path: c.path,
  };
}

export async function createCategory(
  input: CmsCategoryInput,
): Promise<CategoryRow> {
  const taken = await takenSlugs(categoriesTable);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .insert(categoriesTable)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      path: input.path ?? `/blog/category/${slug}/`,
      originalUrl: input.originalUrl ?? null,
    })
    .returning();
  return mapCategory(row!);
}

export async function updateCategory(
  id: string,
  input: CmsCategoryUpdate,
): Promise<CategoryRow | null> {
  const [existing] = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.id, id))
    .limit(1);
  if (!existing) return null;
  const taken = await takenSlugs(categoriesTable, id);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .update(categoriesTable)
    .set({
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      path: input.path ?? `/blog/category/${slug}/`,
      originalUrl: input.originalUrl ?? null,
      updatedAt: new Date(),
    })
    .where(eq(categoriesTable.id, id))
    .returning();
  return row ? mapCategory(row) : null;
}

/**
 * Delete a category, reparenting any direct children to the deleted category's
 * own parent (its grandparent) first. The `parent_id` FK has no cascade, so a
 * naive delete of a category that still has children would either error or
 * strand them with a dangling parent reference; lifting them one level keeps the
 * hierarchy intact and orphan-free. Page links (`page_categories`) cascade and
 * `pages.primary_category_id` is set null by its FK.
 */
export async function deleteCategory(id: string): Promise<boolean> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    const [existing] = await tx
      .select({ id: categoriesTable.id, parentId: categoriesTable.parentId })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, id))
      .limit(1);
    if (!existing) return false;
    await tx
      .update(categoriesTable)
      .set({ parentId: existing.parentId ?? null, updatedAt: new Date() })
      .where(eq(categoriesTable.parentId, id));
    await tx.delete(categoriesTable).where(eq(categoriesTable.id, id));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function createTag(input: CmsTagInput): Promise<TagRow> {
  const taken = await takenSlugs(tagsTable);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .insert(tagsTable)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      originalUrl: input.originalUrl ?? null,
    })
    .returning();
  return { id: row!.id, name: row!.name, slug: row!.slug, postCount: 0 };
}

export async function updateTag(
  id: string,
  input: CmsTagUpdate,
): Promise<TagRow | null> {
  const [existing] = await db
    .select({ id: tagsTable.id })
    .from(tagsTable)
    .where(eq(tagsTable.id, id))
    .limit(1);
  if (!existing) return null;
  const taken = await takenSlugs(tagsTable, id);
  const slug = uniqueTermSlug(input.slug, input.name, taken);
  const [row] = await db
    .update(tagsTable)
    .set({
      name: input.name,
      slug,
      description: input.description ?? null,
      originalUrl: input.originalUrl ?? null,
    })
    .where(eq(tagsTable.id, id))
    .returning();
  if (!row) return null;
  const links = await db
    .select({ pageId: pageTagsTable.pageId })
    .from(pageTagsTable)
    .where(eq(pageTagsTable.tagId, id));
  return { id: row.id, name: row.name, slug: row.slug, postCount: links.length };
}

// ---------------------------------------------------------------------------
// CMS management rows (full taxonomy view: archived flag + post counts)
// ---------------------------------------------------------------------------

type Exec = typeof db;

export interface CmsAuthorRow extends AuthorRow {
  archived: boolean;
  postCount: number;
}

export interface CmsCategoryRow extends CategoryRow {
  archived: boolean;
  postCount: number;
}

export interface CmsTagRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  archived: boolean;
  postCount: number;
}

export type MergeResult<T> =
  | { ok: true; target: T }
  | { ok: false; reason: "same" | "source" | "target" };

/**
 * List every author (including archived) with the number of pages they author.
 * Counts come from a projected scan of `pages` (id + author_id only — never
 * select the lossless `original_html` blob in a bulk read) tallied in JS.
 */
export async function listAuthorsForCms(): Promise<CmsAuthorRow[]> {
  const rows = await db.select().from(authorsTable);
  const pages = await db
    .select({ authorId: pagesTable.authorId })
    .from(pagesTable);
  const counts = new Map<string, number>();
  for (const p of pages) {
    if (p.authorId) counts.set(p.authorId, (counts.get(p.authorId) ?? 0) + 1);
  }
  return rows
    .map((a) => ({
      ...mapAuthor(a),
      archived: a.archivedAt != null,
      postCount: counts.get(a.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** List every category (including archived) with parent/path and post counts. */
export async function listCategoriesForCms(): Promise<CmsCategoryRow[]> {
  const rows = await db.select().from(categoriesTable);
  const links = await db
    .select({ categoryId: pageCategoriesTable.categoryId })
    .from(pageCategoriesTable);
  const counts = new Map<string, number>();
  for (const l of links) {
    counts.set(l.categoryId, (counts.get(l.categoryId) ?? 0) + 1);
  }
  return rows
    .map((c) => ({
      ...mapCategory(c),
      archived: c.archivedAt != null,
      postCount: counts.get(c.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** List every tag (including archived) with post counts. */
export async function listTagsForCms(): Promise<CmsTagRow[]> {
  const rows = await db.select().from(tagsTable);
  const links = await db
    .select({ tagId: pageTagsTable.tagId })
    .from(pageTagsTable);
  const counts = new Map<string, number>();
  for (const l of links) {
    counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1);
  }
  return rows
    .map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      archived: t.archivedAt != null,
      postCount: counts.get(t.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getCmsAuthor(
  id: string,
  exec: Exec = db,
): Promise<CmsAuthorRow | null> {
  const [a] = await exec
    .select()
    .from(authorsTable)
    .where(eq(authorsTable.id, id))
    .limit(1);
  if (!a) return null;
  const pages = await exec
    .select({ authorId: pagesTable.authorId })
    .from(pagesTable)
    .where(eq(pagesTable.authorId, id));
  return { ...mapAuthor(a), archived: a.archivedAt != null, postCount: pages.length };
}

async function getCmsCategory(
  id: string,
  exec: Exec = db,
): Promise<CmsCategoryRow | null> {
  const [c] = await exec
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.id, id))
    .limit(1);
  if (!c) return null;
  const links = await exec
    .select({ categoryId: pageCategoriesTable.categoryId })
    .from(pageCategoriesTable)
    .where(eq(pageCategoriesTable.categoryId, id));
  return {
    ...mapCategory(c),
    archived: c.archivedAt != null,
    postCount: links.length,
  };
}

async function getCmsTag(id: string, exec: Exec = db): Promise<CmsTagRow | null> {
  const [t] = await exec
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.id, id))
    .limit(1);
  if (!t) return null;
  const links = await exec
    .select({ tagId: pageTagsTable.tagId })
    .from(pageTagsTable)
    .where(eq(pageTagsTable.tagId, id));
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    archived: t.archivedAt != null,
    postCount: links.length,
  };
}

// ---------------------------------------------------------------------------
// Archive / unarchive (soft hide from the public site; reversible)
// ---------------------------------------------------------------------------

export async function archiveAuthor(
  id: string,
  archived: boolean,
): Promise<CmsAuthorRow | null> {
  const [row] = await db
    .update(authorsTable)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(authorsTable.id, id))
    .returning({ id: authorsTable.id });
  if (!row) return null;
  return getCmsAuthor(id);
}

export async function archiveCategory(
  id: string,
  archived: boolean,
): Promise<CmsCategoryRow | null> {
  const [row] = await db
    .update(categoriesTable)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(categoriesTable.id, id))
    .returning({ id: categoriesTable.id });
  if (!row) return null;
  return getCmsCategory(id);
}

export async function archiveTag(
  id: string,
  archived: boolean,
): Promise<CmsTagRow | null> {
  const [row] = await db
    .update(tagsTable)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(tagsTable.id, id))
    .returning({ id: tagsTable.id });
  if (!row) return null;
  return getCmsTag(id);
}

// ---------------------------------------------------------------------------
// Merge (fold a source term into a target; relationships move, source deleted)
// ---------------------------------------------------------------------------

/**
 * Merge `sourceId` into `targetId`: every page tagged with the source is
 * re-tagged with the target (deduped so the `(page_id, tag_id)` PK never
 * collides), the source's links are removed, and the source tag is deleted.
 * Runs in a transaction so a page is never left referencing a deleted tag.
 */
export async function mergeTags(
  sourceId: string,
  targetId: string,
): Promise<MergeResult<CmsTagRow>> {
  if (sourceId === targetId) return { ok: false, reason: "same" };
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Exec;
    const [src] = await tx
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.id, sourceId))
      .limit(1);
    if (!src) return { ok: false, reason: "source" } as const;
    const [tgt] = await tx
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.id, targetId))
      .limit(1);
    if (!tgt) return { ok: false, reason: "target" } as const;

    const srcLinks = await tx
      .select({ pageId: pageTagsTable.pageId })
      .from(pageTagsTable)
      .where(eq(pageTagsTable.tagId, sourceId));
    const tgtLinks = await tx
      .select({ pageId: pageTagsTable.pageId })
      .from(pageTagsTable)
      .where(eq(pageTagsTable.tagId, targetId));
    const tgtSet = new Set(tgtLinks.map((l) => l.pageId));
    const toInsert = srcLinks
      .filter((l) => !tgtSet.has(l.pageId))
      .map((l) => ({ pageId: l.pageId, tagId: targetId }));
    if (toInsert.length) await tx.insert(pageTagsTable).values(toInsert);
    await tx.delete(pageTagsTable).where(eq(pageTagsTable.tagId, sourceId));
    await tx.delete(tagsTable).where(eq(tagsTable.id, sourceId));

    const target = await getCmsTag(targetId, tx);
    return { ok: true, target: target! } as const;
  });
}

/**
 * Merge `sourceId` into `targetId`: page links move (deduped), pages whose
 * primary category was the source are repointed to the target, the source's
 * direct child categories are reparented to the target (a child that *is* the
 * target is lifted to the source's parent instead, so no self/cycle reference
 * is created), then the source category is deleted.
 */
export async function mergeCategories(
  sourceId: string,
  targetId: string,
): Promise<MergeResult<CmsCategoryRow>> {
  if (sourceId === targetId) return { ok: false, reason: "same" };
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Exec;
    const [src] = await tx
      .select({ id: categoriesTable.id, parentId: categoriesTable.parentId })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, sourceId))
      .limit(1);
    if (!src) return { ok: false, reason: "source" } as const;
    const [tgt] = await tx
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, targetId))
      .limit(1);
    if (!tgt) return { ok: false, reason: "target" } as const;

    // Move page links, deduped against existing target links.
    const srcLinks = await tx
      .select({ pageId: pageCategoriesTable.pageId })
      .from(pageCategoriesTable)
      .where(eq(pageCategoriesTable.categoryId, sourceId));
    const tgtLinks = await tx
      .select({ pageId: pageCategoriesTable.pageId })
      .from(pageCategoriesTable)
      .where(eq(pageCategoriesTable.categoryId, targetId));
    const tgtSet = new Set(tgtLinks.map((l) => l.pageId));
    const toInsert = srcLinks
      .filter((l) => !tgtSet.has(l.pageId))
      .map((l) => ({ pageId: l.pageId, categoryId: targetId }));
    if (toInsert.length) await tx.insert(pageCategoriesTable).values(toInsert);
    await tx
      .delete(pageCategoriesTable)
      .where(eq(pageCategoriesTable.categoryId, sourceId));

    // Repoint primary-category pointers.
    await tx
      .update(pagesTable)
      .set({ primaryCategoryId: targetId })
      .where(eq(pagesTable.primaryCategoryId, sourceId));

    // Reparent the source's direct children to the target, lifting the target
    // itself (if it was a child of the source) to the source's parent.
    const children = await tx
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(eq(categoriesTable.parentId, sourceId));
    for (const child of children) {
      const newParent = child.id === targetId ? (src.parentId ?? null) : targetId;
      await tx
        .update(categoriesTable)
        .set({ parentId: newParent, updatedAt: new Date() })
        .where(eq(categoriesTable.id, child.id));
    }

    await tx.delete(categoriesTable).where(eq(categoriesTable.id, sourceId));

    const target = await getCmsCategory(targetId, tx);
    return { ok: true, target: target! } as const;
  });
}

export async function deleteTag(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tagsTable)
    .where(eq(tagsTable.id, id))
    .returning({ id: tagsTable.id });
  return Boolean(deleted);
}
