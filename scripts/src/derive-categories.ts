/**
 * Backfill a clean two-level blog category taxonomy from the per-post
 * BreadcrumbList JSON-LD captured during the crawl.
 *
 * Idempotent + additive: existing category rows are REUSED by `original_url`
 * (their messy slug/name reclaimed) and the ~20 genuinely new ones inserted; the
 * scraped nav/footer "junk" categories are left untouched but become invisible
 * because they never link to a published post.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run categories:backfill            # dry run
 *   pnpm --filter @workspace/scripts run categories:backfill -- --apply # write
 *
 * See `scripts/src/category-taxonomy/index.ts` for the (unit-tested) derivation.
 */
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  categoriesTable,
  pagesTable,
  pageCategoriesTable,
} from "@workspace/db";
import {
  extractLeafCategory,
  deriveCategoryGraph,
  allocateSlugs,
  type PostLeafInput,
  type DerivedCategory,
} from "./category-taxonomy";

const APPLY = process.argv.includes("--apply");

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Distinct published posts and how many have a matched canonical breadcrumb. */
async function loadStats(): Promise<{ totalPublished: number }> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM pages
    WHERE status = 'published' AND page_type = 'post'
  `);
  return { totalPublished: Number(r.rows[0]?.n ?? 0) };
}

/** One leaf category per published post, via the canonical BreadcrumbList. */
async function loadPostLeaves(): Promise<{
  posts: PostLeafInput[];
  matched: number;
}> {
  const res = await db.execute<{ post_id: string; items: unknown }>(sql`
    SELECT p.id AS post_id, j.data->'itemListElement' AS items
    FROM pages p
    JOIN jsonld j ON j.page_id = p.id AND j.type = 'BreadcrumbList'
    WHERE p.status = 'published' AND p.page_type = 'post'
      AND j.data->>'@id' = p.canonical_url || '#breadcrumb'
  `);
  const byPost = new Map<string, PostLeafInput>();
  const matchedPosts = new Set<string>();
  for (const row of res.rows) {
    matchedPosts.add(row.post_id);
    if (byPost.has(row.post_id)) continue;
    const leaf = extractLeafCategory(row.items);
    if (!leaf) continue;
    byPost.set(row.post_id, {
      postId: row.post_id,
      leafName: leaf.name,
      leafUrl: leaf.url,
    });
  }
  return { posts: [...byPost.values()], matched: matchedPosts.size };
}

interface Resolved {
  id: string;
  slug: string;
  isNew: boolean;
}

async function main(): Promise<void> {
  const { totalPublished } = await loadStats();
  const { posts, matched } = await loadPostLeaves();
  const graph = deriveCategoryGraph(posts);

  // Existing rows: reuse by original_url, reclaim clean slugs.
  const existing = await db.execute<{
    id: string;
    slug: string;
    original_url: string | null;
  }>(sql`SELECT id, slug, original_url FROM categories`);
  const byUrl = new Map<string, { id: string; slug: string }>();
  const allSlugs = new Set<string>();
  for (const r of existing.rows) {
    allSlugs.add(r.slug);
    if (r.original_url) byUrl.set(r.original_url, { id: r.id, slug: r.slug });
  }

  // Slugs owned by rows we are NOT reusing must be avoided; reused rows' slugs
  // get reclaimed (freed) so we can reassign clean ones.
  const reused = graph.categories.filter((c) => byUrl.has(c.originalUrl));
  const reusedSlugs = new Set(reused.map((c) => byUrl.get(c.originalUrl)!.slug));
  const taken = new Set([...allSlugs].filter((s) => !reusedSlugs.has(s)));
  const finalSlug = allocateSlugs(graph.categories, taken);

  const resolved = new Map<string, Resolved>();
  for (const c of graph.categories) {
    const ex = byUrl.get(c.originalUrl);
    resolved.set(c.originalUrl, {
      id: ex?.id ?? randomUUID(),
      slug: finalSlug.get(c.originalUrl)!,
      isNew: !ex,
    });
  }

  const pathFor = (c: DerivedCategory): string => {
    const self = resolved.get(c.originalUrl)!;
    if (!c.parentUrl) return self.slug;
    return `${resolved.get(c.parentUrl)!.slug}/${self.slug}`;
  };
  const parentIdFor = (c: DerivedCategory): string | null =>
    c.parentUrl ? resolved.get(c.parentUrl)!.id : null;

  // page_categories link rows (parent + leaf), deduped.
  const linkRows: { pageId: string; categoryId: string }[] = [];
  const linkSeen = new Set<string>();
  for (const a of graph.assignments) {
    for (const url of a.linkUrls) {
      const categoryId = resolved.get(url)!.id;
      const key = `${a.postId}|${categoryId}`;
      if (linkSeen.has(key)) continue;
      linkSeen.add(key);
      linkRows.push({ pageId: a.postId, categoryId });
    }
  }

  // primary_category_id grouped by category.
  const primaryByCat = new Map<string, string[]>();
  for (const a of graph.assignments) {
    const catId = resolved.get(a.primaryUrl)!.id;
    const list = primaryByCat.get(catId);
    if (list) list.push(a.postId);
    else primaryByCat.set(catId, [a.postId]);
  }

  // Published posts with NO derived category must end up fully clean: null
  // primary_category_id and zero page_categories rows. Clearing any links left
  // from earlier crawls keeps junk categories from ever resurfacing and makes
  // the script idempotent regardless of the pre-existing link state.
  const assignedIds = new Set(graph.assignments.map((a) => a.postId));
  const publishedIds = await db.execute<{ id: string }>(sql`
    SELECT id FROM pages WHERE status = 'published' AND page_type = 'post'
  `);
  const staleIds = publishedIds.rows
    .map((r) => r.id)
    .filter((id) => !assignedIds.has(id));

  const toInsert = graph.categories.filter((c) => resolved.get(c.originalUrl)!.isNew);
  const topLevel = graph.categories.filter((c) => c.isTopLevel);

  // --- Report -------------------------------------------------------------
  const navPreview = topLevel
    .map((c) => ({
      name: c.name,
      slug: resolved.get(c.originalUrl)!.slug,
      posts: graph.assignments.filter((a) =>
        a.linkUrls.includes(c.originalUrl),
      ).length,
    }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name));

  console.log(`\n=== derive-categories (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`published posts:           ${totalPublished}`);
  console.log(`with canonical breadcrumb: ${matched}`);
  console.log(`categorized:               ${posts.length}`);
  console.log(`uncategorized (left null): ${totalPublished - posts.length}`);
  console.log(`derived categories:        ${graph.categories.length} (top-level ${topLevel.length})`);
  console.log(`  reuse existing rows:     ${reused.length}`);
  console.log(`  insert new rows:         ${toInsert.length}`);
  console.log(`page_categories links:     ${linkRows.length}`);
  console.log(`\ntop-level categories by post count:`);
  for (const n of navPreview.slice(0, 15)) {
    console.log(`  ${String(n.posts).padStart(4)}  ${n.slug.padEnd(28)} ${n.name}`);
  }
  console.log(`  … ${Math.max(0, navPreview.length - 15)} more`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    await pool.end();
    return;
  }

  // --- Apply --------------------------------------------------------------
  await db.transaction(async (tx) => {
    // 1. Free the slugs on reused rows so reassignment can't collide.
    const reusedIds = reused.map((c) => byUrl.get(c.originalUrl)!.id);
    for (const ids of chunk(reusedIds, 500)) {
      await tx
        .update(categoriesTable)
        .set({ slug: sql`'tmp-' || ${categoriesTable.id}::text` })
        .where(inArray(categoriesTable.id, ids));
    }

    // 2. Insert new top-level rows first (FK parents), then new leaf rows.
    const insertRows = (cats: DerivedCategory[]) =>
      cats.map((c) => ({
        id: resolved.get(c.originalUrl)!.id,
        name: c.name,
        slug: resolved.get(c.originalUrl)!.slug,
        parentId: parentIdFor(c),
        path: pathFor(c),
        originalUrl: c.originalUrl,
      }));
    const newTop = insertRows(toInsert.filter((c) => c.isTopLevel));
    const newLeaf = insertRows(toInsert.filter((c) => !c.isTopLevel));
    for (const ch of chunk(newTop, 500)) await tx.insert(categoriesTable).values(ch);
    for (const ch of chunk(newLeaf, 500)) await tx.insert(categoriesTable).values(ch);

    // 3. Update reused rows: top-level first, then leaves (FK order).
    const updateOrder = [
      ...reused.filter((c) => c.isTopLevel),
      ...reused.filter((c) => !c.isTopLevel),
    ];
    for (const c of updateOrder) {
      const r = resolved.get(c.originalUrl)!;
      await tx
        .update(categoriesTable)
        .set({ name: c.name, slug: r.slug, parentId: parentIdFor(c), path: pathFor(c) })
        .where(eq(categoriesTable.id, r.id));
    }

    // 4. primary_category_id.
    for (const [catId, postIds] of primaryByCat) {
      for (const ch of chunk(postIds, 500)) {
        await tx
          .update(pagesTable)
          .set({ primaryCategoryId: catId })
          .where(inArray(pagesTable.id, ch));
      }
    }

    // 5. page_categories: replace for affected posts (delete then insert).
    const affected = graph.assignments.map((a) => a.postId);
    for (const ch of chunk(affected, 500)) {
      await tx.delete(pageCategoriesTable).where(inArray(pageCategoriesTable.pageId, ch));
    }
    for (const ch of chunk(linkRows, 1000)) {
      await tx.insert(pageCategoriesTable).values(ch);
    }

    // 6. Uncategorized published posts must be fully clean — drop any stale
    //    primary_category_id / page_categories left from earlier crawls so a
    //    junk category can never resurface on a post or in /categories.
    for (const ch of chunk(staleIds, 500)) {
      await tx.update(pagesTable).set({ primaryCategoryId: null }).where(inArray(pagesTable.id, ch));
      await tx.delete(pageCategoriesTable).where(inArray(pageCategoriesTable.pageId, ch));
    }
  });

  // Post-apply invariant: exactly the categorized posts carry a primary, and no
  // uncategorized published post retains a category link.
  const primaries = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pages
    WHERE status = 'published' AND page_type = 'post' AND primary_category_id IS NOT NULL
  `);
  const orphanLinks = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT pc.page_id)::int AS n
    FROM page_categories pc
    JOIN pages p ON p.id = pc.page_id
    WHERE p.status = 'published' AND p.page_type = 'post'
      AND p.primary_category_id IS NULL
  `);
  const nPrimaries = Number(primaries.rows[0]?.n ?? 0);
  const nOrphans = Number(orphanLinks.rows[0]?.n ?? 0);
  if (nPrimaries !== graph.assignments.length || nOrphans !== 0) {
    throw new Error(
      `postcondition failed: primaries=${nPrimaries} (expected ${graph.assignments.length}), uncategorized-with-links=${nOrphans} (expected 0)`,
    );
  }
  console.log(
    `\nApplied. Postcondition OK: ${nPrimaries} posts categorized, 0 stale links on uncategorized posts.\n`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
