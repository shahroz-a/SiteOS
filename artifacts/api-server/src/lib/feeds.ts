import { db } from "@workspace/db";
import { pagesTable, categoriesTable, authorsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { listPosts } from "./posts";

/**
 * Sitemap + RSS generation for the public blog. Both are built from the same
 * data the read API serves and use the blog's public-slug URLs
 * (`/blog/<slug>/`, `/blog/category/<slug>`, `/blog/author/<slug>`) so search
 * engines and feed readers discover exactly what the app renders.
 */

const BLOG_BASE_PATH = "/blog";
const FEED_TITLE = "Headout Blog";
const FEED_DESCRIPTION =
  "Travel inspiration, family destination guides, and holiday ideas from the Headout Blog.";
const RSS_ITEM_LIMIT = 20;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

/**
 * Build a `sitemap.xml` listing the blog index plus every published post,
 * category and author URL. `origin` is the scheme+host (no trailing slash),
 * e.g. `https://example.com`.
 */
export async function buildSitemap(origin: string): Promise<string> {
  const base = `${origin}${BLOG_BASE_PATH}`;
  const urls: SitemapUrl[] = [{ loc: `${base}/` }];

  const posts = await db
    .select({
      slug: pagesTable.slug,
      modifiedAt: pagesTable.modifiedAt,
      publishedAt: pagesTable.publishedAt,
      updatedAt: pagesTable.updatedAt,
    })
    .from(pagesTable)
    .where(
      and(
        eq(pagesTable.status, "published"),
        eq(pagesTable.pageType, "post"),
      ),
    )
    .orderBy(sql`${pagesTable.publishedAt} desc nulls last`);

  for (const post of posts) {
    const lastmod =
      toDate(post.modifiedAt) ??
      toDate(post.publishedAt) ??
      toDate(post.updatedAt);
    urls.push({
      loc: `${base}/${post.slug}/`,
      lastmod: lastmod?.toISOString(),
    });
  }

  const categories = await db
    .select({ slug: categoriesTable.slug, updatedAt: categoriesTable.updatedAt })
    .from(categoriesTable);
  for (const category of categories) {
    urls.push({
      loc: `${base}/category/${category.slug}`,
      lastmod: toDate(category.updatedAt)?.toISOString(),
    });
  }

  const authors = await db
    .select({ slug: authorsTable.slug, updatedAt: authorsTable.updatedAt })
    .from(authorsTable);
  for (const author of authors) {
    urls.push({
      loc: `${base}/author/${author.slug}`,
      lastmod: toDate(author.updatedAt)?.toISOString(),
    });
  }

  const body = urls
    .map((url) => {
      const lastmod = url.lastmod
        ? `\n    <lastmod>${url.lastmod}</lastmod>`
        : "";
      return `  <url>\n    <loc>${xmlEscape(url.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Build an RSS 2.0 feed of the most recent published posts.
 */
export async function buildRssFeed(origin: string): Promise<string> {
  const base = `${origin}${BLOG_BASE_PATH}`;
  const { items } = await listPosts({ page: 1, limit: RSS_ITEM_LIMIT });
  const buildDate = new Date().toUTCString();

  const entries = items
    .map((post) => {
      const link = `${base}/${post.slug}/`;
      const description = post.excerpt ?? post.subtitle ?? "";
      const published = toDate(post.publishedAt);
      const pubDate = `\n      <pubDate>${(published ?? new Date()).toUTCString()}</pubDate>`;
      const creator = post.author?.name
        ? `\n      <dc:creator>${xmlEscape(post.author.name)}</dc:creator>`
        : "";
      const category = post.primaryCategory?.name
        ? `\n      <category>${xmlEscape(post.primaryCategory.name)}</category>`
        : "";
      return `    <item>\n      <title>${xmlEscape(post.title)}</title>\n      <link>${xmlEscape(link)}</link>\n      <guid isPermaLink="true">${xmlEscape(link)}</guid>${pubDate}${creator}${category}\n      <description>${xmlEscape(description)}</description>\n    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${xmlEscape(FEED_TITLE)}</title>\n    <link>${xmlEscape(`${base}/`)}</link>\n    <atom:link href="${xmlEscape(`${base}/feed.xml`)}" rel="self" type="application/rss+xml" />\n    <description>${xmlEscape(FEED_DESCRIPTION)}</description>\n    <language>en</language>\n    <lastBuildDate>${buildDate}</lastBuildDate>\n${entries}\n  </channel>\n</rss>\n`;
}
