import {
  BUNDLE_VERSION,
  normalizeBundle,
  type BundlePost,
  type ContentBundle,
} from "./types.js";

/**
 * CSV is a deliberately flat, spreadsheet-friendly view of posts. It carries the
 * scalar post fields plus pipe-joined taxonomy slugs and the cleaned HTML body.
 * Nested structures (faq, images, links, structured data, component tree) are
 * NOT representable in a flat table and are dropped — CSV is a lossy editorial
 * format, so importing a CSV updates the scalar fields and body of matching
 * posts without touching their nested children. Use JSON for lossless transport.
 */
const COLUMNS = [
  "slug",
  "title",
  "subtitle",
  "excerpt",
  "status",
  "language",
  "canonicalUrl",
  "originalUrl",
  "pathname",
  "parentPath",
  "authorSlug",
  "primaryCategorySlug",
  "categorySlugs",
  "tagSlugs",
  "featuredImageUrl",
  "featuredImageAlt",
  "readingTimeMinutes",
  "wordCount",
  "publishedAt",
  "modifiedAt",
  "contentHtml",
] as const;

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("|");
  return String(value);
}

export function serializeCsv(bundle: ContentBundle): string {
  const lines: string[] = [COLUMNS.map(escapeField).join(",")];
  for (const post of bundle.posts) {
    const row: Record<(typeof COLUMNS)[number], unknown> = {
      slug: post.slug,
      title: post.title,
      subtitle: post.subtitle,
      excerpt: post.excerpt,
      status: post.status,
      language: post.language,
      canonicalUrl: post.canonicalUrl,
      originalUrl: post.originalUrl,
      pathname: post.pathname,
      parentPath: post.parentPath,
      authorSlug: post.authorSlug,
      primaryCategorySlug: post.primaryCategorySlug,
      categorySlugs: post.categorySlugs,
      tagSlugs: post.tagSlugs,
      featuredImageUrl: post.featuredImageUrl,
      featuredImageAlt: post.featuredImageAlt,
      readingTimeMinutes: post.readingTimeMinutes,
      wordCount: post.wordCount,
      publishedAt: post.publishedAt,
      modifiedAt: post.modifiedAt,
      contentHtml: post.contentHtml,
    };
    lines.push(COLUMNS.map((c) => escapeField(cell(row[c]))).join(","));
  }
  return lines.join("\r\n");
}

/** Parse an RFC 4180 CSV string into rows of string cells. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row (unless the input ended on a newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function splitList(value: string): string[] {
  return value
    ? value
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function numOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string): ContentBundle {
  const rows = parseRows(text).filter(
    (r) => r.length > 1 || (r.length === 1 && r[0]!.trim() !== ""),
  );
  if (rows.length === 0) {
    return normalizeBundle({ bundleVersion: BUNDLE_VERSION });
  }
  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const posts: Partial<BundlePost>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (name: string): string => {
      const i = idx(name);
      return i >= 0 && i < cells.length ? cells[i]! : "";
    };
    const slug = get("slug").trim();
    if (!slug) continue;
    posts.push({
      slug,
      title: get("title"),
      subtitle: get("subtitle") || null,
      excerpt: get("excerpt") || null,
      status: get("status") || "draft",
      language: get("language") || "en",
      canonicalUrl: get("canonicalUrl"),
      originalUrl: get("originalUrl") || null,
      pathname: get("pathname"),
      parentPath: get("parentPath") || null,
      authorSlug: get("authorSlug") || null,
      primaryCategorySlug: get("primaryCategorySlug") || null,
      categorySlugs: splitList(get("categorySlugs")),
      tagSlugs: splitList(get("tagSlugs")),
      featuredImageUrl: get("featuredImageUrl") || null,
      featuredImageAlt: get("featuredImageAlt") || null,
      readingTimeMinutes: numOrNull(get("readingTimeMinutes")),
      wordCount: numOrNull(get("wordCount")),
      publishedAt: get("publishedAt") || null,
      modifiedAt: get("modifiedAt") || null,
      contentHtml: get("contentHtml") || null,
    });
  }
  return normalizeBundle({ bundleVersion: BUNDLE_VERSION, posts });
}
