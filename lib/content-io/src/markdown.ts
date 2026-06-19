import {
  BUNDLE_VERSION,
  normalizeBundle,
  type BundlePost,
  type ContentBundle,
  type SerializedFile,
} from "./types.js";

/**
 * Markdown export emits one document per post: a YAML-style front-matter block
 * (scalar fields + inline taxonomy arrays) followed by the cleaned HTML body
 * (raw HTML is valid Markdown). Front-matter values are JSON-encoded so the
 * parser is trivial and unambiguous — no YAML library required.
 *
 * Like CSV, Markdown is a body-focused editorial format: nested structures (faq,
 * images, links, structured data, component tree) are not carried, so importing
 * a Markdown bundle updates scalar fields + body without touching nested rows.
 *
 * A combined bundle joins the per-post documents with an explicit `@@FILE`
 * marker so the whole set round-trips through a single string.
 */
const FILE_MARKER = "<!-- @@FILE:";

const FRONT_MATTER_FIELDS = [
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
] as const;

function postFrontMatter(post: BundlePost): Record<string, unknown> {
  return {
    slug: post.slug,
    title: post.title,
    subtitle: post.subtitle ?? null,
    excerpt: post.excerpt ?? null,
    status: post.status,
    language: post.language,
    canonicalUrl: post.canonicalUrl,
    originalUrl: post.originalUrl ?? null,
    pathname: post.pathname,
    parentPath: post.parentPath ?? null,
    authorSlug: post.authorSlug ?? null,
    primaryCategorySlug: post.primaryCategorySlug ?? null,
    categorySlugs: post.categorySlugs,
    tagSlugs: post.tagSlugs,
    featuredImageUrl: post.featuredImageUrl ?? null,
    featuredImageAlt: post.featuredImageAlt ?? null,
    readingTimeMinutes: post.readingTimeMinutes ?? null,
    wordCount: post.wordCount ?? null,
    publishedAt: post.publishedAt ?? null,
    modifiedAt: post.modifiedAt ?? null,
  };
}

export function serializePostMarkdown(post: BundlePost): string {
  const fm = postFrontMatter(post);
  const lines = ["---"];
  for (const key of FRONT_MATTER_FIELDS) {
    lines.push(`${key}: ${JSON.stringify(fm[key])}`);
  }
  lines.push("---", "");
  lines.push(post.contentHtml ?? "");
  return lines.join("\n");
}

function safeFilename(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleaned || "post"}.md`;
}

export function serializeMarkdownFiles(bundle: ContentBundle): SerializedFile[] {
  return bundle.posts.map((post) => ({
    filename: safeFilename(post.slug),
    contentType: "text/markdown",
    content: serializePostMarkdown(post),
  }));
}

export function serializeMarkdown(bundle: ContentBundle): string {
  return bundle.posts
    .map(
      (post) =>
        `${FILE_MARKER} ${safeFilename(post.slug)} -->\n${serializePostMarkdown(post)}`,
    )
    .join("\n\n");
}

function parseFrontMatter(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const valueText = line.slice(sep + 1).trim();
    try {
      out[key] = valueText === "" ? null : JSON.parse(valueText);
    } catch {
      out[key] = valueText;
    }
  }
  return out;
}

export function parsePostMarkdown(doc: string): Partial<BundlePost> | null {
  const text = doc.replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const fm = parseFrontMatter(match[1]!);
  const slug = typeof fm.slug === "string" ? fm.slug.trim() : "";
  if (!slug) return null;
  const body = text.slice(match[0].length).replace(/^\n+/, "");
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : [];
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;
  return {
    slug,
    title: typeof fm.title === "string" ? fm.title : "",
    subtitle: strOrNull(fm.subtitle),
    excerpt: strOrNull(fm.excerpt),
    status: typeof fm.status === "string" ? fm.status : "draft",
    language: typeof fm.language === "string" ? fm.language : "en",
    canonicalUrl: typeof fm.canonicalUrl === "string" ? fm.canonicalUrl : "",
    originalUrl: strOrNull(fm.originalUrl),
    pathname: typeof fm.pathname === "string" ? fm.pathname : "",
    parentPath: strOrNull(fm.parentPath),
    authorSlug: strOrNull(fm.authorSlug),
    primaryCategorySlug: strOrNull(fm.primaryCategorySlug),
    categorySlugs: arr(fm.categorySlugs),
    tagSlugs: arr(fm.tagSlugs),
    featuredImageUrl: strOrNull(fm.featuredImageUrl),
    featuredImageAlt: strOrNull(fm.featuredImageAlt),
    readingTimeMinutes: numOrNull(fm.readingTimeMinutes),
    wordCount: numOrNull(fm.wordCount),
    publishedAt: strOrNull(fm.publishedAt),
    modifiedAt: strOrNull(fm.modifiedAt),
    contentHtml: body || null,
  };
}

export function parseMarkdown(text: string): ContentBundle {
  const src = text.replace(/\r\n/g, "\n");
  const docs: string[] = [];
  if (src.includes(FILE_MARKER)) {
    for (const chunk of src.split(FILE_MARKER)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      // Drop the residual "filename -->" header line left by the split.
      const afterHeader = trimmed.replace(/^[^\n]*-->\n?/, "");
      if (afterHeader.trim()) docs.push(afterHeader);
    }
  } else {
    docs.push(src);
  }
  const posts: Partial<BundlePost>[] = [];
  for (const doc of docs) {
    const post = parsePostMarkdown(doc);
    if (post) posts.push(post);
  }
  return normalizeBundle({ bundleVersion: BUNDLE_VERSION, posts });
}
