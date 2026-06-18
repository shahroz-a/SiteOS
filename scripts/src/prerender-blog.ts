/**
 * Build-time prerenderer for the static blog (`artifacts/blog`).
 *
 * The blog ships as a Vite SPA served statically with a `/* -> /index.html`
 * rewrite, so every URL otherwise returns the same generic `index.html`. Social
 * crawlers and some search engines do not run JavaScript, so the per-route
 * title / description / canonical / Open Graph / Twitter / JSON-LD tags that the
 * `useSeo` hook sets at runtime are invisible to them.
 *
 * This script runs after `vite build`: it reads the built `index.html`, computes
 * the exact same head tags each route would set (see `./prerender/seo.ts`) from
 * the database, and writes a prerendered HTML file per article, category, author
 * and the search shell. The static file server then serves the correct,
 * crawler-visible metadata for every shared link.
 *
 * It is best-effort: if the database is unreachable it logs a warning and exits
 * 0 so a deploy build never fails over prerendering (the app still works via the
 * SPA fallback, just without crawler-visible per-route tags).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import {
  pagesTable,
  seoTable,
  jsonldTable,
  categoriesTable,
  authorsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  injectSeo,
  isSafeSlug,
  outputPathsFor,
  indexSeo,
  searchSeo,
  categorySeo,
  authorSeo,
  articleSeo,
  type SeoTags,
} from "./prerender/seo";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const DIST_DIR =
  process.env.BLOG_DIST ??
  path.resolve(repoRoot, "artifacts", "blog", "dist", "public");

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function writeRoute(
  template: string,
  tags: SeoTags,
  files: string[],
): Promise<number> {
  const html = injectSeo(template, tags);
  for (const rel of files) {
    const dest = path.join(DIST_DIR, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, html, "utf8");
  }
  return files.length;
}

async function run(): Promise<void> {
  const indexPath = path.join(DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `Built index.html not found at ${indexPath}. Run \`vite build\` before prerendering.`,
    );
  }
  const template = await readFile(indexPath, "utf8");

  let written = 0;
  let pages = 0;

  // Index + search shell.
  written += await writeRoute(template, indexSeo(), outputPathsFor("index"));
  written += await writeRoute(template, searchSeo(), outputPathsFor("search"));
  pages += 2;

  // Articles: every published post page, with its SEO row and JSON-LD blocks.
  const posts = await db
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      excerpt: pagesTable.excerpt,
      canonicalUrl: pagesTable.canonicalUrl,
      featuredImageUrl: pagesTable.featuredImageUrl,
    })
    .from(pagesTable)
    .where(
      and(eq(pagesTable.status, "published"), eq(pagesTable.pageType, "post")),
    );

  // Fetch the per-post SEO overrides and JSON-LD blocks in small id-batches.
  // The Supabase session pooler enforces a statement timeout, so a single
  // wholesale select of the (large, JSONB-heavy) jsonld table can be cancelled
  // mid-flight. Bounded `inArray` batches keep every query small and fast.
  const seoByPage = new Map<
    string,
    {
      metaTitle: string | null;
      metaDescription: string | null;
      canonicalUrl: string | null;
      ogTitle: string | null;
      ogDescription: string | null;
      ogImage: string | null;
    }
  >();
  const jsonldByPage = new Map<string, { position: number; data: unknown }[]>();
  let jsonldWarned = false;

  for (const ids of chunk(posts.map((p) => p.id), 200)) {
    const seoRows = await db
      .select({
        pageId: seoTable.pageId,
        metaTitle: seoTable.metaTitle,
        metaDescription: seoTable.metaDescription,
        canonicalUrl: seoTable.canonicalUrl,
        ogTitle: seoTable.ogTitle,
        ogDescription: seoTable.ogDescription,
        ogImage: seoTable.ogImage,
      })
      .from(seoTable)
      .where(inArray(seoTable.pageId, ids));
    for (const s of seoRows) {
      const { pageId, ...rest } = s;
      seoByPage.set(pageId, rest);
    }

    // JSON-LD is enrichment, not core to social previews; never fail the build
    // over it. Degrade to no structured data for the batch if it errors.
    try {
      const jl = await db
        .select({
          pageId: jsonldTable.pageId,
          position: jsonldTable.position,
          data: jsonldTable.data,
        })
        .from(jsonldTable)
        .where(inArray(jsonldTable.pageId, ids));
      for (const row of jl) {
        const list = jsonldByPage.get(row.pageId) ?? [];
        list.push({ position: row.position ?? 0, data: row.data });
        jsonldByPage.set(row.pageId, list);
      }
    } catch (error) {
      if (!jsonldWarned) {
        console.warn(
          "[prerender-blog] JSON-LD fetch failed; omitting structured data.",
          error,
        );
        jsonldWarned = true;
      }
    }
  }

  const jsonldFor = (pageId: string): unknown[] =>
    (jsonldByPage.get(pageId) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((row) => row.data);

  for (const post of posts) {
    if (!isSafeSlug(post.slug)) continue;
    const seo = seoByPage.get(post.id);
    const tags = articleSeo({
      title: post.title,
      excerpt: post.excerpt,
      canonicalUrl: post.canonicalUrl,
      featuredImageUrl: post.featuredImageUrl,
      seo: seo
        ? {
            metaTitle: seo.metaTitle,
            metaDescription: seo.metaDescription,
            canonicalUrl: seo.canonicalUrl,
            ogTitle: seo.ogTitle,
            ogDescription: seo.ogDescription,
            ogImage: seo.ogImage,
          }
        : null,
      jsonLd: jsonldFor(post.id),
    });
    written += await writeRoute(template, tags, outputPathsFor("article", post.slug));
    pages += 1;
  }

  // Categories.
  const categories = await db
    .select({
      slug: categoriesTable.slug,
      name: categoriesTable.name,
      description: categoriesTable.description,
    })
    .from(categoriesTable);
  for (const category of categories) {
    if (!isSafeSlug(category.slug)) continue;
    written += await writeRoute(
      template,
      categorySeo(category),
      outputPathsFor("category", category.slug),
    );
    pages += 1;
  }

  // Authors.
  const authors = await db
    .select({
      slug: authorsTable.slug,
      name: authorsTable.name,
      bio: authorsTable.bio,
    })
    .from(authorsTable);
  for (const author of authors) {
    if (!isSafeSlug(author.slug)) continue;
    written += await writeRoute(
      template,
      authorSeo(author),
      outputPathsFor("author", author.slug),
    );
    pages += 1;
  }

  console.log(
    `[prerender-blog] Prerendered ${pages} routes (${written} files) into ${DIST_DIR}`,
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[prerender-blog] DATABASE_URL is not set; skipping prerender. " +
        "The blog will fall back to generic index.html metadata for crawlers.",
    );
    return;
  }

  try {
    await run();
  } catch (error) {
    if (error instanceof Error && /index\.html not found/.test(error.message)) {
      // A missing build output is a real failure, not a transient DB issue.
      throw error;
    }
    console.warn(
      "[prerender-blog] Prerender failed; serving generic metadata instead.",
      error,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[prerender-blog]", error);
  process.exit(1);
});
