import type { ComponentNode, ExtractedPage, RichTextNode } from "./types";

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
  source: Record<string, number>;
  parsed: Record<string, number>;
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
 * Compare the source DOM counts against the normalized output. A page only
 * passes when the structured representation preserves the source's content
 * volume; significant loss is a `fail` that triggers a retry upstream.
 */
export function validateExtraction(page: ExtractedPage): ValidationResult {
  const parsedRt: Record<string, number> = {};
  countRichText(page.richText, parsedRt);
  const parsedTree: Record<string, number> = {};
  countTree(page.componentTree, parsedTree);

  const source = {
    headings: page.counts.headings,
    paragraphs: page.counts.paragraphs,
    images: page.counts.images,
    links: page.counts.links,
    tables: page.counts.tables,
    lists: page.counts.lists,
  };
  const parsed = {
    headings: parsedRt.headings ?? 0,
    paragraphs: parsedRt.paragraphs ?? 0,
    images: page.images.length,
    links: parsedRt.links ?? 0,
    tables: parsedRt.tables ?? 0,
    lists: parsedRt.lists ?? 0,
    components: parsedTree.components ?? 0,
  };

  const issues: ValidationIssue[] = [];
  const check = (field: keyof typeof source, tolerance: number) => {
    const s = source[field];
    const p = parsed[field];
    if (s === 0) return;
    const ratio = p / s;
    if (ratio < tolerance) {
      issues.push({
        field,
        source: s,
        parsed: p,
        severity: ratio < tolerance * 0.6 ? "fail" : "warn",
        message: `parsed ${field} (${p}) below source (${s})`,
      });
    }
  };

  // Headings/paragraphs must be well preserved; media/links a bit looser.
  check("headings", 0.9);
  check("paragraphs", 0.9);
  check("tables", 0.9);
  check("lists", 0.85);
  check("images", 0.8);

  if (page.title === "Untitled" || page.title.trim() === "") {
    issues.push({
      field: "title",
      source: 1,
      parsed: 0,
      severity: "fail",
      message: "page title could not be extracted",
    });
  }
  if (parsed.components === 0 && source.paragraphs > 0) {
    issues.push({
      field: "components",
      source: source.paragraphs,
      parsed: 0,
      severity: "fail",
      message: "component tree is empty despite source content",
    });
  }

  const hasFail = issues.some((i) => i.severity === "fail");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const status: ValidationResult["status"] = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  const score = Math.max(0, 100 - issues.length * (hasFail ? 25 : 10));

  return { status, score, issues, source, parsed };
}
