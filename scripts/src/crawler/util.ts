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
  if (/\/blog\/author\//.test(path)) return "author";
  if (/\/blog\/category\//.test(path)) return "category";
  if (/\/blog\/tag\//.test(path)) return "tag";
  if (/\/blog\/web-stories?\//.test(path)) return "page";
  if (sitemapSource) {
    if (sitemapSource.includes("author-sitemap")) return "author";
    if (sitemapSource.includes("category-sitemap")) return "category";
    if (sitemapSource.includes("web-story-sitemap")) return "page";
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
