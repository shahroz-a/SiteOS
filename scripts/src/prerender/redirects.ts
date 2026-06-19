/**
 * Prerender-only helpers for serving the preserved redirect map as static files.
 *
 * The migrated blog ships as a Vite SPA served statically with a
 * `/* -> /index.html` rewrite (which returns 200), so the static host has no way
 * to emit a true server-side `301`. To keep old, renamed and retired article
 * URLs working after the migration — so existing bookmarks, inbound links and
 * search rankings don't break — we instead materialise one tiny HTML "redirect
 * stub" file per old path at build time. A real file at the old path takes
 * precedence over the SPA rewrite, and the stub forwards instantly via a
 * zero-delay `<meta http-equiv="refresh">` plus a `<link rel="canonical">` to
 * the destination (the combination search engines treat as a permanent redirect
 * and use to consolidate ranking signals) and a `location.replace` for users.
 *
 * Kept side-effect free (no DB, no fs) so the stub building can be unit tested
 * in isolation; `prerender-blog.ts` queries the `redirects` table and writes the
 * files.
 */

import { escapeAttr } from "@workspace/blog-seo";

/**
 * Origin used to resolve redirect targets that point off the blog (e.g. retired
 * articles that now redirect to a Headout product/category page). On-blog
 * targets stay root-relative so they resolve against whatever domain the
 * migrated blog is deployed on.
 */
export const OFF_BLOG_ORIGIN = "https://www.headout.com";

const BLOG_PREFIX = "/blog/";

/** A single path segment is safe only if it has no separators, traversal, or
 * URL-significant punctuation — this filters out the malformed junk fromPaths
 * the crawler recorded (embedded absolute URLs, query strings, map links, …). */
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Output file paths (relative to the static publicDir) for a redirect whose old
 * path is `fromPath`, or `null` if the path can't be safely turned into static
 * files. Only paths under `/blog/` are served (the blog owns that prefix); the
 * empty blog root is never redirected. Both the flat `<rel>.html` and nested
 * `<rel>/index.html` forms are emitted so the host resolves the old URL with or
 * without a trailing slash, mirroring `outputPathsFor`.
 */
export function redirectFilePaths(fromPath: string): string[] | null {
  if (!fromPath.startsWith(BLOG_PREFIX)) return null;
  const rel = fromPath.slice(BLOG_PREFIX.length).replace(/\/+$/, "");
  if (rel === "") return null;
  const segments = rel.split("/");
  const safe = segments.every(
    (s) => s !== "." && s !== ".." && SAFE_SEGMENT.test(s),
  );
  if (!safe) return null;
  return [`${rel}.html`, `${rel}/index.html`];
}

/**
 * Resolve a redirect `toPath` into the URL the stub should forward to. On-blog
 * targets stay root-relative (they live on the migrated deployment); everything
 * else (retired pages now pointing at product/category pages) is made absolute
 * against the live Headout origin.
 */
export function redirectTargetUrl(toPath: string): string {
  if (toPath.startsWith(BLOG_PREFIX)) return toPath;
  return `${OFF_BLOG_ORIGIN}${toPath.startsWith("/") ? "" : "/"}${toPath}`;
}

/**
 * Render the redirect stub HTML that forwards to `target`. `target` is assumed
 * to already be resolved via `redirectTargetUrl`.
 */
export function renderRedirectHtml(target: string): string {
  const attr = escapeAttr(target);
  const js = JSON.stringify(target);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting…</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${attr}" />
    <meta http-equiv="refresh" content="0; url=${attr}" />
    <script>location.replace(${js});</script>
  </head>
  <body>
    <p>This page has moved. <a href="${attr}">Continue to the new location</a>.</p>
  </body>
</html>
`;
}

export interface RedirectStub {
  /** Files (relative to publicDir) to write the stub to. */
  files: string[];
  /** The forwarding HTML. */
  html: string;
  /** The resolved destination URL (for logging/tests). */
  target: string;
}

/**
 * Build the static redirect stub for a single `{ fromPath, toPath }` entry, or
 * `null` if the old path can't be served safely as static files. Self-redirects
 * (old path equals the resolved target) are skipped — they'd create a refresh
 * loop and add no value.
 */
export function buildRedirectStub(
  fromPath: string,
  toPath: string,
): RedirectStub | null {
  const files = redirectFilePaths(fromPath);
  if (!files) return null;
  const target = redirectTargetUrl(toPath);
  if (target === fromPath) return null;
  return { files, html: renderRedirectHtml(target), target };
}
