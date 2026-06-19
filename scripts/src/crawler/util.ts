import { createHash } from "node:crypto";
import { SITE_ORIGIN, BLOG_PREFIX } from "./config";
import type { PageType } from "./types";

/** Stable sha-256 hex digest of a string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Normalise a URL for deduplication: lowercase host, drop fragment + utm-ish params, keep path. */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  // Drop common tracking params that never identify distinct content.
  const drop = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "ref",
  ];
  for (const key of drop) u.searchParams.delete(key);
  u.host = u.host.toLowerCase();
  return u.toString();
}

export function isBlogUrl(url: string): boolean {
  return url.startsWith(BLOG_PREFIX);
}

/**
 * Strip NUL (`\u0000`) bytes, which Postgres `text`/`jsonb` columns reject
 * (error 22021 for text, 22P05 for jsonb). Scraped binary or malformed bytes
 * can carry NULs; left in, a single one aborts the whole insert.
 */
export function stripNul(input: string): string {
  return input.includes("\u0000") ? input.replace(/\u0000/g, "") : input;
}

const ASSET_EXT =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mp3|wav|ogg|pdf|zip|gz|rar|7z|css|js|mjs|woff2?|ttf|eot|otf|doc|docx|xls|xlsx|ppt|pptx|csv)$/i;

/**
 * True for non-page resources (media/static assets, WordPress internals) that
 * must never be crawled and stored as articles. Frontier links on a page often
 * point at uploaded images (`/wp-content/uploads/…/foo.jpg`); fetching those
 * returns binary whose bytes Postgres can't store as page content.
 */
export function isAssetUrl(url: string): boolean {
  const path = pathnameOf(url).replace(/\/+$/, "");
  if (/\/wp-content\/|\/wp-json\/|\/wp-includes\//.test(path)) return true;
  return ASSET_EXT.test(path);
}

/**
 * Collapse accidental repeated slashes in a URL's path (e.g.
 * `…/singapore-zoo//` → `…/singapore-zoo/`), which source markup frequently
 * produces. The `scheme://` separator and the query/hash are left untouched.
 * Returns the input unchanged if it can't be parsed.
 */
export function collapseSlashes(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/{2,}/g, "/");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * True when a blog URL's path is structurally malformed — an artifact of bad
 * source markup, not a real page: a bare domain mistakenly used as a relative
 * link (`…/introducingathens.com`, `…/www.collectionpage.com`) or a concatenated
 * href carrying an embedded protocol/quote (`…/:%22https://…`, `…/“https://…`).
 * Such links never resolve, so enqueuing them only inflates the permanent-failure
 * count. Non-page assets are handled separately by `isAssetUrl`.
 */
export function isMalformedBlogUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  const path = u.pathname;
  // An embedded protocol or quote character left over from a concatenated href.
  if (/\/https?:|:\/\/|%22|%27|%e2%80%9[cd]|["'<>]/i.test(path)) return true;
  // Repeated slashes (`…/venice-itinerary//`) are a source-markup artifact: the
  // URL is just a duplicate of its slash-collapsed form, never a distinct page.
  if (/\/{2,}/.test(path)) return true;
  const segments = path.split("/").filter(Boolean);
  for (const seg of segments) {
    // Real WordPress slugs are always lowercase; an uppercase letter marks a
    // mis-cased duplicate (`/Melbourne-travel-guide/`) or a junk template token
    // (`/LINK`) that only ever resolves to the canonical lowercase page already
    // crawled. Decode first so percent-encoding hex (`%E2…`) isn't misread as a
    // letter — genuine encoded junk is already caught by the checks above.
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return true;
    }
    if (/[A-Z]/.test(decoded)) return true;
    // A leading-hyphen segment (e.g. `…/paris-3-day-itinerary/-catacombs/`) is a
    // botched relative link — a trailing `/-…` fragment joined onto the path.
    // Real WordPress slugs are never produced with a leading hyphen.
    if (seg.startsWith("-")) return true;
    // A segment containing whitespace (`…/No%20Data`, `…/Basilica%20di%20San…`)
    // is alt-text/label text mistakenly captured as an href. Real WordPress slugs
    // are hyphenated and never contain a space.
    if (/%20|\s/i.test(seg)) return true;
    // A path segment that is itself a hostname (dot-separated label). Real blog
    // slugs never contain a dot, so any dotted non-asset segment is garbage.
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(seg)) return true;
  }
  // A doubled / over-nested taxonomy path. A `category`/`author`/`tag` listing
  // legitimately carries at most a slug plus an optional collection-code segment
  // (e.g. `/blog/category/things-to-do-city-singapore/tickets-…-ca-1__23209/`).
  // Anything deeper (e.g. `/blog/category/…/wp-…/wcp-…/`) is a frontier-expanded
  // artifact that can never resolve to a real page.
  const taxonomyIdx = segments.findIndex((s) => s === "category" || s === "author" || s === "tag");
  if (taxonomyIdx >= 0 && segments.length - taxonomyIdx - 1 > 2) return true;
  return false;
}

/**
 * The single shared gate for "is this href a clean, crawlable blog URL we should
 * act on": it lives under the blog prefix, isn't a non-page asset, and isn't
 * structurally malformed source-markup junk. Accidental repeated slashes are
 * collapsed first (so `…/foo//bar` is judged by its canonical `…/foo/bar` form),
 * matching how the frontier normalises before enqueuing.
 *
 * Using ONE predicate across frontier expansion, redirect-chain capture, and
 * redirect storage guarantees a malformed/off-blog href can never slip through
 * one path while being filtered by another — the bad hrefs that produced the
 * junk redirect rows are dropped consistently at every stage, so they never
 * inflate the queue's permanent-failure count or reach the redirect list.
 */
export function isCleanBlogUrl(url: string): boolean {
  const collapsed = collapseSlashes(url);
  return isBlogUrl(collapsed) && !isAssetUrl(collapsed) && !isMalformedBlogUrl(collapsed);
}

/**
 * True when a redirect destination ("to") will forward readers to a clean,
 * resolvable URL once stored. Storage (`crawler/store.ts` + the prerender's
 * `redirectTargetUrl`) keeps only the destination's PATH and reattaches an
 * off-blog path to the Headout origin, so this check mirrors that contract — a
 * hop that fails it would otherwise be persisted as a redirect to a broken
 * target:
 *  - On-blog targets reuse the shared `isCleanBlogUrl` gate (collapses repeated
 *    slashes, rejects embedded URLs, query/junk segments, mis-cased/over-nested
 *    paths).
 *  - Off-blog targets are kept ONLY when they already live on the Headout origin.
 *    A foreign host (e.g. a Google Maps link or any embedded third-party URL)
 *    would have its host stripped and be silently re-hosted under headout.com,
 *    forwarding readers to a path that doesn't exist there — so it's dropped.
 *    The path must also be structurally sane: no embedded protocol/quote,
 *    leading-hyphen fragment, whitespace, bare-domain segment, or malformed
 *    percent-encoding.
 * Returns false for anything unparseable.
 */
export function isResolvableRedirectTarget(url: string): boolean {
  const collapsed = collapseSlashes(url);
  if (isBlogUrl(collapsed)) return isCleanBlogUrl(collapsed);
  let u: URL;
  try {
    u = new URL(collapsed);
  } catch {
    return false;
  }
  if (u.origin !== SITE_ORIGIN) return false;
  const path = u.pathname;
  if (/\/https?:|:\/\/|%22|%27|%e2%80%9[cd]|["'<>]/i.test(path)) return false;
  for (const seg of path.split("/").filter(Boolean)) {
    try {
      decodeURIComponent(seg);
    } catch {
      return false;
    }
    if (seg.startsWith("-")) return false;
    if (/%20|\s/i.test(seg)) return false;
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(seg)) return false;
  }
  return true;
}

/**
 * True when a queue item was discovered by frontier link-expansion (its
 * `discoveredFrom` is the page it was found on) rather than from a sitemap.
 * A frontier link that 404s is a dead internal link in source content — cruft,
 * not a migration blocker — so it can be skipped instead of failed; a missing
 * sitemap-declared URL still fails loudly.
 */
export function isFrontierDiscovered(discoveredFrom: string | null | undefined): boolean {
  return !!discoveredFrom && !discoveredFrom.includes("sitemap");
}

export function isInternalUrl(url: string): boolean {
  try {
    return new URL(url).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

export function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Final non-empty path segment, used as the public slug. */
export function slugFromUrl(url: string): string {
  const path = pathnameOf(url).replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export function parentPathOf(url: string): string | null {
  const path = pathnameOf(url).replace(/\/+$/, "");
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx + 1);
}

/**
 * Classify a blog URL into a Payload-compatible page type using both the
 * sitemap source it was discovered from and URL path heuristics.
 */
export function classifyUrl(url: string, sitemapSource?: string | null): PageType {
  const path = pathnameOf(url);
  // Non-blog URLs are Headout commerce/main-site pages (e.g. `/museums-rome-sc-…`,
  // `/london-theatre-tickets/…`), never editorial articles. They must not default
  // to `post` or the read API would serve them as blog articles.
  if (!path.includes("/blog/")) return "page";
  if (/\/blog\/author\//.test(path)) return "author";
  if (/\/blog\/category\//.test(path)) return "category";
  if (/\/blog\/tag\//.test(path)) return "tag";
  if (/\/blog\/web-stories?\//.test(path)) return "web-story";
  if (sitemapSource) {
    if (sitemapSource.includes("author-sitemap")) return "author";
    if (sitemapSource.includes("category-sitemap")) return "category";
    if (sitemapSource.includes("web-story-sitemap")) return "web-story";
    if (sitemapSource.includes("page-sitemap")) return "page";
    if (sitemapSource.includes("post-sitemap")) return "post";
  }
  // Pagination / archive listings.
  if (/\/page\/\d+\/?$/.test(path)) return "landing";
  return "post";
}

/** Discovery priority — render the most content-rich types first. */
export function priorityForType(type: PageType): number {
  switch (type) {
    case "post":
      return 100;
    case "page":
      return 80;
    case "category":
      return 60;
    case "author":
      return 50;
    case "tag":
      return 40;
    case "web-story":
      return 30;
    default:
      return 20;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collapse repeated whitespace while preserving single spaces. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
