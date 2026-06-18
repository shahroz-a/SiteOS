import { createHash } from "node:crypto";

/** Stable slug from arbitrary text. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Title-case a slug for a human-readable fallback name. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Collapse runs of whitespace to single spaces and trim. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Canonicalize a URL for comparison/storage: lower-case host, drop the query
 * and hash, and enforce a trailing slash on directory-style paths. This is what
 * lets internal links resolve to a target page reliably.
 */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase();
  if (!u.pathname.endsWith("/") && !/\.[a-z0-9]{2,5}$/i.test(u.pathname)) {
    u.pathname += "/";
  }
  return u.toString();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function lastPathSegment(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function parentPathOf(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  parts.pop();
  return "/" + parts.join("/") + "/";
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function domainOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
