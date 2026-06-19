import { eq, sql } from "drizzle-orm";
import {
  db,
  authorsTable,
  categoriesTable,
  tagsTable,
  pageTagsTable,
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

export async function deleteCategory(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(categoriesTable)
    .where(eq(categoriesTable.id, id))
    .returning({ id: categoriesTable.id });
  return Boolean(deleted);
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
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pageTagsTable)
    .where(eq(pageTagsTable.tagId, id));
  return { id: row.id, name: row.name, slug: row.slug, postCount: count ?? 0 };
}

export async function deleteTag(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tagsTable)
    .where(eq(tagsTable.id, id))
    .returning({ id: tagsTable.id });
  return Boolean(deleted);
}
