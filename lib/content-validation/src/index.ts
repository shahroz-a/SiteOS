/**
 * Pure, DB-agnostic content-fidelity validation scoring shared between the
 * migration scripts (crawler/re-validation/reports) and the CMS read API. No
 * I/O, no Drizzle queries — only the scoring rules and the helpers that
 * re-derive a verdict from already-captured tallies. Keeping this in one lib
 * means the crawl path, the offline re-validation job, the migration reports,
 * and the CMS held-back queue can never drift on what "held back" means.
 */
import type { pageTypeEnum } from "@workspace/db";

export type PageType = (typeof pageTypeEnum.enumValues)[number];

export interface ValidationIssue {
  field: string;
  source: number;
  parsed: number;
  severity: "warn" | "fail";
  message: string;
}

export interface ValidationResult {
  status: "pass" | "warn" | "fail";
  score: number;
  issues: ValidationIssue[];
  source: CountSet;
  parsed: CountSet;
}

/** Counts the validator compares; `components` is the parsed component-tree size. */
export interface CountSet {
  headings: number;
  paragraphs: number;
  images: number;
  links: number;
  tables: number;
  lists: number;
  components?: number;
}

export interface ScoreInput {
  source: CountSet;
  parsed: CountSet;
  title: string;
  pageType: PageType;
  url: string;
}

/**
 * Whether a URL is a genuine blog article (the only thing content-fidelity
 * validation applies to). Taxonomy listings (category/author/tag), web-story
 * decks, search-result pages, paginated index pages, and non-blog commerce
 * pages are navigational/structural — their raw DOM never maps to an article
 * body, so volume comparisons are meaningless and must not hold them back.
 */
export function isArticleUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname;
  if (!path.includes("/blog/")) return false; // non-blog (commerce / main-site) pages
  if (parsed.searchParams.has("s")) return false; // /blog/?s=… search results
  if (/\/blog\/(category|author|tag|web-stories?)\//.test(path)) return false;
  if (/\/page\/\d+\/?$/.test(path)) return false; // paginated index pages
  return true;
}

/** Content-fidelity validation only applies to genuine blog articles. */
export function isArticlePage(pageType: PageType, url: string): boolean {
  return pageType === "post" && isArticleUrl(url);
}

/**
 * Score an extraction from already-computed source/parsed counts.
 *
 * Curation legitimately removes widget/nav/FAQ/related-list noise the raw DOM
 * carries, so a partial element shortfall is expected and is only a `warn`
 * (informational — never held back). A page is `fail`ed (held back for editor
 * review) only on catastrophic extraction loss: a missing title or an
 * empty/near-empty component tree despite real source prose. Non-article pages
 * are exempt from content-fidelity checks entirely.
 */
export function scoreValidation(input: ScoreInput): ValidationResult {
  const { source, parsed, title, pageType, url } = input;

  if (!isArticlePage(pageType, url)) {
    return { status: "pass", score: 100, issues: [], source, parsed };
  }

  const issues: ValidationIssue[] = [];
  const components = parsed.components ?? 0;

  // Informational shortfall warnings — never hold a page back.
  const warnShortfall = (field: keyof CountSet, tolerance: number) => {
    const s = source[field] ?? 0;
    const p = parsed[field] ?? 0;
    if (s === 0) return;
    if (p / s < tolerance) {
      issues.push({
        field,
        source: s,
        parsed: p,
        severity: "warn",
        message: `parsed ${field} (${p}) below source (${s})`,
      });
    }
  };
  warnShortfall("headings", 0.9);
  warnShortfall("paragraphs", 0.9);
  warnShortfall("tables", 0.9);
  warnShortfall("lists", 0.85);
  warnShortfall("images", 0.8);

  // Catastrophic failures — extraction is broken, hold the article back.
  if (title === "Untitled" || title.trim() === "") {
    issues.push({
      field: "title",
      source: 1,
      parsed: 0,
      severity: "fail",
      message: "page title could not be extracted",
    });
  }
  if (components === 0 && source.paragraphs > 0) {
    issues.push({
      field: "components",
      source: source.paragraphs,
      parsed: 0,
      severity: "fail",
      message: "component tree is empty despite source content",
    });
  } else if (components < 3 && source.paragraphs >= 10) {
    issues.push({
      field: "components",
      source: source.paragraphs,
      parsed: components,
      severity: "fail",
      message: "component tree is nearly empty despite substantial source content",
    });
  }

  const hasFail = issues.some((i) => i.severity === "fail");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const status: ValidationResult["status"] = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  const score = Math.max(0, 100 - issues.length * (hasFail ? 25 : 10));

  return { status, score, issues, source, parsed };
}

/** An all-zero count set — the safe default when a stored row has no tallies. */
export const ZERO_COUNTS: CountSet = {
  headings: 0,
  paragraphs: 0,
  images: 0,
  links: 0,
  tables: 0,
  lists: 0,
  components: 0,
};

/** Coerce an untrusted stored JSON blob into a {@link CountSet} (non-numbers → 0). */
export function toCountSet(raw: unknown): CountSet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    headings: num(r.headings),
    paragraphs: num(r.paragraphs),
    images: num(r.images),
    links: num(r.links),
    tables: num(r.tables),
    lists: num(r.lists),
    components: num(r.components),
  };
}

/**
 * Re-derive the CURRENT validation verdict for a stored validation row WITHOUT
 * re-crawling. Reuses the source/parsed tallies captured on the row's `issues`
 * blob (shape `{ source, parsed }`) and re-scores them against the live
 * {@link scoreValidation} rules using the page's current type/url/title. This is
 * the single source of truth shared by the offline re-validation job, the
 * report generator, and the CMS held-back queue, so a stale row written by an
 * older validator (e.g. one that wrongly failed non-article pages) can never be
 * trusted at face value.
 */
export function rescoreStoredValidation(
  storedIssues: unknown,
  page: { pageType: PageType; url: string | null; title: string | null },
): ValidationResult {
  const stored = (storedIssues ?? {}) as { source?: unknown; parsed?: unknown };
  const source = stored.source ? toCountSet(stored.source) : ZERO_COUNTS;
  const parsed = stored.parsed ? toCountSet(stored.parsed) : ZERO_COUNTS;
  return scoreValidation({
    source,
    parsed,
    title: page.title ?? "",
    pageType: page.pageType,
    url: page.url ?? "",
  });
}
