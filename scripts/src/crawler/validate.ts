import type { ComponentNode, ExtractedPage, RichTextNode } from "./types";
import { scoreValidation, type CountSet, type ValidationResult } from "@workspace/content-validation";

// Re-export the shared, DB-agnostic validation scoring so existing crawler
// imports (`./validate`) keep working while the rules live in one lib
// (`@workspace/content-validation`) shared with the CMS read API.
export {
  isArticleUrl,
  isArticlePage,
  scoreValidation,
  rescoreStoredValidation,
  toCountSet,
  ZERO_COUNTS,
} from "@workspace/content-validation";
export type {
  CountSet,
  ScoreInput,
  ValidationIssue,
  ValidationResult,
} from "@workspace/content-validation";

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
    if (node.blockType === "image" || node.blockType === "gallery")
      acc.treeImages = (acc.treeImages ?? 0) + 1;
    if (node.children) countTree(node.children, acc);
  }
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
