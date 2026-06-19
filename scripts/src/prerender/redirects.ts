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
 * Normalise a redirect `fromPath` into the clean, blog-serveable form, or
 * `null` if it can't be salvaged. Collapses accidental repeated slashes, then
 * keeps the path only if the serving step could actually emit a stub for it
 * (under `/blog/`, non-empty, every segment safe). This is the single source of
 * truth for "is this redirect serveable" — recording (`crawler/store.ts`) runs
 * it before persisting a `redirects` row so the table never stores a path the
 * prerender would later skip (off-blog paths, the bare blog root, or junk
 * carrying embedded URLs / query strings / map links).
 */
export function normalizeRedirectFromPath(fromPath: string): string | null {
  const collapsed = fromPath.replace(/\/{2,}/g, "/");
  return redirectFilePaths(collapsed) ? collapsed : null;
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
 * Why an active redirect produced no forwarding stub. These are the only reasons
 * {@link buildRedirectStub} can return `null`, and they map one-to-one to the
 * cleanup an operator would do:
 *  - `non-blog-source`: the old path isn't under `/blog/` (the blog can't own
 *    or serve it) — the redirect belongs on whatever host owns that prefix, not
 *    here; deactivate or move it.
 *  - `malformed-segment`: the old path is under `/blog/` but is the bare root or
 *    carries an unsafe segment (embedded URL, query string, map link, `..`,
 *    encoded punctuation, …) the crawler recorded as junk; fix or deactivate the
 *    `from_path`.
 *  - `self-redirect`: the resolved target equals the old path, which would loop;
 *    deactivate it.
 */
export type RedirectSkipReason =
  | "non-blog-source"
  | "malformed-segment"
  | "self-redirect";

/**
 * Discriminated outcome of evaluating a single redirect: either the stub to
 * write, or the reason no stub could be produced. This is the single source of
 * truth behind both {@link buildRedirectStub} (serving) and the operator-facing
 * skipped-redirect report (`reports.ts`), so the "why was this dropped" grouping
 * can never drift from the serving logic.
 */
export type RedirectStubResult =
  | { stub: RedirectStub; reason: null }
  | { stub: null; reason: RedirectSkipReason };

/**
 * Classify a single `{ fromPath, toPath }` redirect into either a writable stub
 * or the precise reason it can't be served. See {@link RedirectSkipReason} for
 * what each reason means and how an operator resolves it.
 */
export function classifyRedirect(
  fromPath: string,
  toPath: string,
): RedirectStubResult {
  if (!fromPath.startsWith(BLOG_PREFIX)) {
    return { stub: null, reason: "non-blog-source" };
  }
  const files = redirectFilePaths(fromPath);
  if (!files) return { stub: null, reason: "malformed-segment" };
  const target = redirectTargetUrl(toPath);
  if (target === fromPath) return { stub: null, reason: "self-redirect" };
  return { stub: { files, html: renderRedirectHtml(target), target }, reason: null };
}

/**
 * Build the static redirect stub for a single `{ fromPath, toPath }` entry, or
 * `null` if the old path can't be served safely as static files. Self-redirects
 * (old path equals the resolved target) are skipped — they'd create a refresh
 * loop and add no value. Use {@link classifyRedirect} when you need to know
 * *why* a stub was skipped.
 */
export function buildRedirectStub(
  fromPath: string,
  toPath: string,
): RedirectStub | null {
  return classifyRedirect(fromPath, toPath).stub;
}
