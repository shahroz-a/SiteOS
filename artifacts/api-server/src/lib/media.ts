import { db, imagesTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

/**
 * Media library logic. A "media item" is a unique CDN image keyed by its
 * `url`, aggregated across every `images` row (each row is one usage on one
 * page). The library never re-uploads binaries — it reuses the existing
 * Headout CDN URL.
 *
 * Accessibility validation classifies alt text as `ok` / `missing` / `poor`.
 * The classification rules live in EXACTLY ONE place: the SQL CASE expression
 * built by `altStatusCaseSql` (so pagination, the `onlyIssues` filter and the
 * summary counts all agree). The pure `altIssueMessages` helper only translates
 * a status + alt into human-readable warnings; it does not re-implement the
 * rules.
 */

export type MediaAltStatus = "ok" | "missing" | "poor";

/** Alt text shorter than this (after trimming) is considered "poor". */
const MIN_ALT_LENGTH = 10;

/** Generic placeholder words that don't describe the image. */
const GENERIC_ALT_WORDS = [
  "image",
  "photo",
  "picture",
  "img",
  "untitled",
  "logo",
  "icon",
  "banner",
  "thumbnail",
  "image1",
  "photo1",
];

/**
 * SQL CASE expression (as raw text) classifying the given alt-text column into
 * `missing` / `poor` / `ok`. `col` MUST be a trusted column expression — never
 * user input — because it is interpolated raw.
 *
 * This is the single source of truth for alt classification. Keep
 * `altIssueMessages` (message wording) in step with the cases here.
 */
function altStatusCaseSql(col: string): string {
  const generic = GENERIC_ALT_WORDS.map((w) => `'${w}'`).join(", ");
  return `CASE
    WHEN ${col} IS NULL OR btrim(${col}) = '' THEN 'missing'
    WHEN char_length(btrim(${col})) < ${MIN_ALT_LENGTH}
      OR lower(btrim(${col})) IN (${generic})
      OR lower(btrim(${col})) ~ '\\.(jpg|jpeg|png|gif|webp|svg|avif)$'
      THEN 'poor'
    ELSE 'ok'
  END`;
}

/**
 * Translate an alt status (+ the alt value) into human-readable accessibility
 * warnings. Pure and unit-tested; mirrors the wording of `altStatusCaseSql`.
 */
export function altIssueMessages(
  status: MediaAltStatus,
  alt: string | null,
): string[] {
  if (status === "missing") {
    return ["Missing alt text — screen readers can't describe this image."];
  }
  if (status === "poor") {
    const trimmed = (alt ?? "").trim();
    const lower = trimmed.toLowerCase();
    const issues: string[] = [];
    if (trimmed.length < MIN_ALT_LENGTH) {
      issues.push("Alt text is too short to be descriptive.");
    }
    if (GENERIC_ALT_WORDS.includes(lower)) {
      issues.push(`Alt text "${trimmed}" is a generic placeholder.`);
    }
    if (/\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(lower)) {
      issues.push("Alt text looks like a filename, not a description.");
    }
    if (issues.length === 0) {
      issues.push("Alt text is too generic to be descriptive.");
    }
    return issues;
  }
  return [];
}

/** Vision model used to describe images for alt-text suggestions. */
const ALT_SUGGEST_MODEL = "gpt-5-mini";

/** Upper bound on a suggested alt description (chars). */
const MAX_SUGGESTED_ALT_LENGTH = 250;

/**
 * Ask a vision model to describe an image for use as accessibility alt text.
 * Returns a single concise, descriptive sentence with no surrounding quotes or
 * boilerplate prefixes. Throws if the model returns nothing usable.
 */
export async function suggestAltText(url: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: ALT_SUGGEST_MODEL,
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You write concise, accurate alt text for images on a travel blog. " +
          "Describe what is visually in the image in one factual sentence " +
          "(roughly 5-20 words) that helps a screen-reader user understand it. " +
          "Do not start with phrases like 'image of' or 'a picture of'. Do not " +
          "add quotes, markdown, or commentary — return only the description.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Suggest alt text for this image.",
          },
          {
            type: "image_url",
            image_url: { url },
          },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const suggestion = cleanSuggestion(raw);
  if (!suggestion) {
    throw new Error("The vision model returned an empty description.");
  }
  return suggestion;
}

/** Max images processed in one batch suggest request. */
export const MAX_ALT_SUGGEST_BATCH = 50;

/** How many vision calls to run concurrently within a batch. */
const ALT_SUGGEST_BATCH_CONCURRENCY = 4;

/** The outcome of suggesting alt text for a single image in a batch. */
export interface BatchAltSuggestion {
  url: string;
  suggestion: string | null;
  error: string | null;
}

/**
 * Suggest alt text for many images in one pass, with bounded concurrency. Each
 * image is described independently: a failure on one (bad URL, model error) is
 * captured as that result's `error` and never aborts the rest of the batch.
 * Results are returned in the same order as the input `urls`.
 */
export async function suggestAltTextBatch(
  urls: string[],
): Promise<BatchAltSuggestion[]> {
  const results: BatchAltSuggestion[] = urls.map((url) => ({
    url,
    suggestion: null,
    error: null,
  }));

  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const index = next++;
      const url = urls[index];
      try {
        results[index].suggestion = await suggestAltText(url);
      } catch (err) {
        results[index].error =
          err instanceof Error ? err.message : "Couldn't generate a suggestion.";
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(ALT_SUGGEST_BATCH_CONCURRENCY, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Strip wrapping quotes/whitespace and clamp the length of a raw suggestion. */
function cleanSuggestion(raw: string): string {
  let text = raw.trim();
  // Drop a single layer of wrapping quotes the model sometimes adds.
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.length > MAX_SUGGESTED_ALT_LENGTH) {
    text = text.slice(0, MAX_SUGGESTED_ALT_LENGTH).trimEnd();
  }
  return text;
}

/** Before/after snapshot of a media item's alt text for the audit trail. */
export interface AltSnapshot {
  alt: string | null;
  altStatus: MediaAltStatus;
}

/** Result of saving reviewed alt text, with before/after for auditing. */
export interface UpdateAltResult {
  updatedUsages: number;
  before: AltSnapshot;
  after: AltSnapshot;
}

/**
 * Persist reviewed alt text for a media item: every `images` row sharing the
 * given CDN `url` is updated (the library aggregates by URL, so a single edit
 * applies to every page that uses the image). `updatedUsages` is how many rows
 * changed; 0 means no image with that URL exists. `before`/`after` capture the
 * representative alt and its accessibility classification for the audit trail —
 * the status is computed by the single source of truth (`altStatusCaseSql`).
 */
export async function updateAltByUrl(
  url: string,
  alt: string,
): Promise<UpdateAltResult> {
  // Snapshot the representative (longest) alt and its status before editing.
  const beforeRes = await db.execute(sql`
    WITH grouped AS (
      SELECT (array_agg(alt ORDER BY char_length(coalesce(alt, '')) DESC))[1] AS alt
      FROM images
      WHERE url = ${url}
    )
    SELECT alt, ${sql.raw(altStatusCaseSql("alt"))} AS alt_status
    FROM grouped
  `);
  const beforeRow = (beforeRes.rows[0] ?? {}) as Record<string, unknown>;
  const before: AltSnapshot = {
    alt: toStringOrNull(beforeRow.alt),
    altStatus: coerceAltStatus(beforeRow.alt_status),
  };

  const updated = await db
    .update(imagesTable)
    .set({ alt })
    .where(eq(imagesTable.url, url))
    .returning({ id: imagesTable.id });

  // Every usage now shares the same alt, so the after status is deterministic.
  const afterRes = await db.execute(sql`
    SELECT ${sql.raw(altStatusCaseSql("alt_val"))} AS alt_status
    FROM (SELECT ${alt}::text AS alt_val) t
  `);
  const afterRow = (afterRes.rows[0] ?? {}) as Record<string, unknown>;
  const after: AltSnapshot = {
    alt,
    altStatus: coerceAltStatus(afterRow.alt_status),
  };

  return { updatedUsages: updated.length, before, after };
}

export interface ListMediaParams {
  page: number;
  limit: number;
  q?: string;
  onlyIssues: boolean;
}

export interface MediaUsagePage {
  id: string;
  slug: string;
  title: string;
  status: string;
  pathname: string;
  alt: string | null;
  altStatus: MediaAltStatus;
}

export interface MediaItem {
  url: string;
  originalUrl: string | null;
  alt: string | null;
  title: string | null;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  role: string | null;
  usageCount: number;
  pageCount: number;
  altStatus: MediaAltStatus;
  altIssues: string[];
  pages: MediaUsagePage[];
}

export interface MediaListResult {
  items: MediaItem[];
  total: number;
  summary: { totalImages: number; withAltIssues: number };
}

function toIntOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toStringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function coerceAltStatus(value: unknown): MediaAltStatus {
  return value === "missing" || value === "poor" ? value : "ok";
}

/**
 * The grouped-image CTE shared by the list and count queries. Aggregates every
 * `images` row by `url` and picks the most descriptive (longest) alt as the
 * representative value, applying the optional search filter.
 */
function groupedCte(q?: string) {
  const search = q ? `%${q}%` : null;
  const where = search
    ? sql`WHERE (url ILIKE ${search} OR alt ILIKE ${search} OR caption ILIKE ${search} OR title ILIKE ${search})`
    : sql``;
  return sql`
    grouped AS (
      SELECT
        url,
        (array_agg(original_url) FILTER (WHERE original_url IS NOT NULL AND original_url <> ''))[1] AS original_url,
        (array_agg(alt ORDER BY char_length(coalesce(alt, '')) DESC))[1] AS alt,
        (array_agg(title) FILTER (WHERE title IS NOT NULL AND title <> ''))[1] AS title,
        (array_agg(caption) FILTER (WHERE caption IS NOT NULL AND caption <> ''))[1] AS caption,
        (array_agg(credit) FILTER (WHERE credit IS NOT NULL AND credit <> ''))[1] AS credit,
        max(width) AS width,
        max(height) AS height,
        (array_agg(mime_type) FILTER (WHERE mime_type IS NOT NULL AND mime_type <> ''))[1] AS mime_type,
        (array_agg(role) FILTER (WHERE role IS NOT NULL AND role <> ''))[1] AS role,
        count(*)::int AS usage_count,
        count(DISTINCT page_id)::int AS page_count
      FROM images
      ${where}
      GROUP BY url
    ),
    classified AS (
      SELECT *, ${sql.raw(altStatusCaseSql("alt"))} AS alt_status
      FROM grouped
    )`;
}

/**
 * Fetch the referencing pages for a slice of media URLs. Returns one row per
 * (url, page) with that page's most descriptive alt and its classification.
 */
async function fetchPagesForUrls(
  urls: string[],
): Promise<Map<string, MediaUsagePage[]>> {
  const byUrl = new Map<string, MediaUsagePage[]>();
  if (urls.length === 0) return byUrl;

  const result = await db.execute(sql`
    SELECT
      i.url AS url,
      p.id AS id,
      p.slug AS slug,
      p.title AS title,
      p.status AS status,
      p.pathname AS pathname,
      (array_agg(i.alt ORDER BY char_length(coalesce(i.alt, '')) DESC))[1] AS alt,
      ${sql.raw(altStatusCaseSql("(array_agg(i.alt ORDER BY char_length(coalesce(i.alt, '')) DESC))[1]"))} AS alt_status
    FROM images i
    JOIN pages p ON p.id = i.page_id
    WHERE i.url IN (${sql.join(
      urls.map((u) => sql`${u}`),
      sql`, `,
    )})
    GROUP BY i.url, p.id, p.slug, p.title, p.status, p.pathname
    ORDER BY p.title ASC
  `);

  for (const row of result.rows as Record<string, unknown>[]) {
    const url = String(row.url);
    const list = byUrl.get(url) ?? [];
    list.push({
      id: String(row.id),
      slug: String(row.slug ?? ""),
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      pathname: String(row.pathname ?? ""),
      alt: toStringOrNull(row.alt),
      altStatus: coerceAltStatus(row.alt_status),
    });
    byUrl.set(url, list);
  }
  return byUrl;
}

/** Max referencing pages returned per media item. */
const MAX_PAGES_PER_ITEM = 100;

/**
 * List the media library: unique CDN images with usage counts, referencing
 * pages and alt-text accessibility validation. Most-used images first.
 */
export async function listMedia(
  params: ListMediaParams,
): Promise<MediaListResult> {
  const { page, limit, q, onlyIssues } = params;
  const offset = (page - 1) * limit;
  const cte = groupedCte(q);

  // Summary + paginated total in one pass over the classified set.
  const countResult = await db.execute(sql`
    WITH ${cte}
    SELECT
      count(*)::int AS total_all,
      count(*) FILTER (WHERE alt_status <> 'ok')::int AS total_issues
    FROM classified
  `);
  const countRow = (countResult.rows[0] ?? {}) as Record<string, unknown>;
  const totalAll = toIntOrNull(countRow.total_all) ?? 0;
  const totalIssues = toIntOrNull(countRow.total_issues) ?? 0;
  const total = onlyIssues ? totalIssues : totalAll;

  const issueFilter = onlyIssues ? sql`WHERE alt_status <> 'ok'` : sql``;
  const listResult = await db.execute(sql`
    WITH ${cte}
    SELECT * FROM classified
    ${issueFilter}
    ORDER BY usage_count DESC, url ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const rows = listResult.rows as Record<string, unknown>[];
  const urls = rows.map((r) => String(r.url));
  const pagesByUrl = await fetchPagesForUrls(urls);

  const items: MediaItem[] = rows.map((row) => {
    const url = String(row.url);
    const alt = toStringOrNull(row.alt);
    const altStatus = coerceAltStatus(row.alt_status);
    return {
      url,
      originalUrl: toStringOrNull(row.original_url),
      alt,
      title: toStringOrNull(row.title),
      caption: toStringOrNull(row.caption),
      credit: toStringOrNull(row.credit),
      width: toIntOrNull(row.width),
      height: toIntOrNull(row.height),
      mimeType: toStringOrNull(row.mime_type),
      role: toStringOrNull(row.role),
      usageCount: toIntOrNull(row.usage_count) ?? 0,
      pageCount: toIntOrNull(row.page_count) ?? 0,
      altStatus,
      altIssues: altIssueMessages(altStatus, alt),
      pages: (pagesByUrl.get(url) ?? []).slice(0, MAX_PAGES_PER_ITEM),
    };
  });

  return {
    items,
    total,
    summary: { totalImages: totalAll, withAltIssues: totalIssues },
  };
}
