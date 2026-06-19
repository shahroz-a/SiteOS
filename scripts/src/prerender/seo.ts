/**
 * Prerender-only helpers for injecting per-route `<head>` metadata into the
 * static HTML produced by `vite build`.
 *
 * The actual tag-building logic (title / description / canonical / Open Graph /
 * Twitter / JSON-LD, including all fallback rules) lives in the shared
 * `@workspace/blog-seo` lib, which is the single source of truth used by BOTH
 * this prerender path and the client-side `useSeo` hook. This file only adds
 * the bits that are specific to writing static files: stripping the template's
 * default tags, choosing output paths, and slug safety.
 *
 * Kept side-effect free (no DB, no fs) so the HTML injection can be unit tested
 * in isolation.
 */

import { renderSeoTags, type SeoTags } from "@workspace/blog-seo";

export {
  renderSeoTags,
  escapeAttr,
  escapeText,
  buildSeoTagList,
  applySeoTags,
  DEFAULT_OG_IMAGE,
  indexSeo,
  searchSeo,
  categorySeo,
  authorSeo,
  articleSeo,
} from "@workspace/blog-seo";
export type {
  SeoTags,
  SeoTagSpec,
  ArticleSeoInput,
  SeoDocument,
  SeoElement,
} from "@workspace/blog-seo";

const TITLE_RE = /<title>[\s\S]*?<\/title>\s*/i;
const DESCRIPTION_RE = /<meta\s+name="description"[^>]*>\s*/gi;
const CANONICAL_RE = /<link\s+rel="canonical"[^>]*>\s*/gi;
const OG_RE = /<meta\s+property="og:[^"]*"[^>]*>\s*/gi;
const TWITTER_RE = /<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi;

/**
 * Replace the SEO-related tags in a built `index.html` with freshly rendered
 * ones for a specific route. Removes the template's default title, description,
 * canonical, Open Graph and Twitter tags (the `robots` meta is preserved), then
 * inserts the new block immediately before `</head>`.
 */
export function injectSeo(html: string, tags: SeoTags): string {
  let out = html
    .replace(TITLE_RE, "")
    .replace(DESCRIPTION_RE, "")
    .replace(CANONICAL_RE, "")
    .replace(OG_RE, "")
    .replace(TWITTER_RE, "");

  const block = `${renderSeoTags(tags)}\n  `;
  const headCloseIndex = out.search(/<\/head>/i);
  if (headCloseIndex === -1) {
    throw new Error("Could not find </head> in the HTML template.");
  }
  out = out.slice(0, headCloseIndex) + block + out.slice(headCloseIndex);
  return out;
}

/** A slug is only safe as a path segment if it has no separators or traversal. */
export function isSafeSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    !slug.includes("/") &&
    !slug.includes("\\") &&
    !slug.includes("..")
  );
}

/**
 * Output file paths (relative to the static publicDir) for a route. Both the
 * `<segment>.html` and `<segment>/index.html` forms are written so the static
 * file server resolves the route regardless of which clean-URL convention it
 * uses or whether the request carries a trailing slash.
 */
export function outputPathsFor(
  kind: "index" | "search" | "article" | "category" | "author",
  slug?: string,
): string[] {
  switch (kind) {
    case "index":
      return ["index.html"];
    case "search":
      return ["search.html", "search/index.html"];
    case "article":
      return [`${slug}.html`, `${slug}/index.html`];
    case "category":
      return [`category/${slug}.html`, `category/${slug}/index.html`];
    case "author":
      return [`author/${slug}.html`, `author/${slug}/index.html`];
  }
}
