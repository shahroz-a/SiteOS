import type { ComponentNode, ExtractedPage, PageType, RichTextNode } from "./types";

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

function countRichText(node: RichTextNode, acc: Record<string, number>): void {
  switch (node.type) {
    case "heading":
      acc.headings = (acc.headings ?? 0) + 1;
      break;
    case "paragraph":
      acc.paragraphs = (acc.paragraphs ?? 0) + 1;
      break;
    case "list":
      acc.lists = (acc.lists ?? 0) + 1;
      break;
    case "table":
      acc.tables = (acc.tables ?? 0) + 1;
      break;
    case "image":
    case "inlineImage":
      acc.images = (acc.images ?? 0) + 1;
      break;
    case "link":
      acc.links = (acc.links ?? 0) + 1;
      break;
  }
  for (const child of node.children ?? []) countRichText(child, acc);
}

function countTree(nodes: ComponentNode[], acc: Record<string, number>): void {
  for (const node of nodes) {
    acc.components = (acc.components ?? 0) + 1;
    if (node.type === "image" || node.type === "gallery") acc.treeImages = (acc.treeImages ?? 0) + 1;
    if (node.children) countTree(node.children, acc);
  }
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

/**
 * Compare the source DOM counts against the normalized output for a freshly
 * extracted page. Delegates the scoring rules to {@link scoreValidation} so the
 * crawl path and the offline re-validation path stay in lockstep.
 */
export function validateExtraction(page: ExtractedPage): ValidationResult {
  const parsedRt: Record<string, number> = {};
  countRichText(page.richText, parsedRt);
  const parsedTree: Record<string, number> = {};
  countTree(page.componentTree, parsedTree);

  const source: CountSet = {
    headings: page.counts.headings,
    paragraphs: page.counts.paragraphs,
    images: page.counts.images,
    links: page.counts.links,
    tables: page.counts.tables,
    lists: page.counts.lists,
  };
  const parsed: CountSet = {
    headings: parsedRt.headings ?? 0,
    paragraphs: parsedRt.paragraphs ?? 0,
    images: page.images.length,
    links: parsedRt.links ?? 0,
    tables: parsedRt.tables ?? 0,
    lists: parsedRt.lists ?? 0,
    components: parsedTree.components ?? 0,
  };

  return scoreValidation({
    source,
    parsed,
    title: page.title,
    pageType: page.pageType,
    url: page.canonicalUrl || page.finalUrl || page.requestedUrl,
  });
}
