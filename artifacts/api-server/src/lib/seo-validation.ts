/**
 * DB glue around the pure `@workspace/seo-validation` engine.
 *
 * Builds the engine's input from a serialized `CmsPostDetail`, runs the DB
 * duplicate-detection queries the engine can't do on its own, persists the
 * result to the existing `validation_reports` table, and exposes the publish
 * gate the publish flow (transition + PUT) calls to block critical failures.
 *
 * The rule catalogue itself lives in the lib so the CMS panel and this server
 * code can never disagree on what "valid" means.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { db, pagesTable, seoTable, validationReportsTable } from "@workspace/db";
import {
  validateSeo,
  effectiveTitle,
  effectiveDescription,
  type SeoValidationInput,
  type SeoValidationResult,
  type DuplicateContext,
  type DuplicateRef,
  type HeadingNode,
} from "@workspace/seo-validation";
import {
  serializeCmsPostDetail,
  type CmsPostDetail,
  type Executor,
} from "./cms-content";

const REPORT_TYPE = "seo";

interface TreeNode {
  type?: string;
  blockType?: string;
  text?: string;
  data?: { level?: number } & Record<string, unknown>;
  children?: unknown[];
}

/** Recursively collect headings (level + text) from a componentTree. */
function collectHeadings(tree: unknown, out: HeadingNode[]): void {
  if (!Array.isArray(tree)) return;
  for (const raw of tree) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as TreeNode;
    const kind = node.type ?? node.blockType;
    if (kind === "heading") {
      out.push({ level: Number(node.data?.level ?? 2), text: String(node.text ?? "") });
    }
    if (Array.isArray(node.children)) collectHeadings(node.children, out);
  }
}

/** Recursively count content blocks in a componentTree. */
function countNodes(tree: unknown): number {
  if (!Array.isArray(tree)) return 0;
  let n = 0;
  for (const raw of tree) {
    if (!raw || typeof raw !== "object") continue;
    n += 1;
    const node = raw as TreeNode;
    if (Array.isArray(node.children)) n += countNodes(node.children);
  }
  return n;
}

/** Translate a serialized post detail into the pure engine's input shape. */
export function buildValidationInput(detail: CmsPostDetail): SeoValidationInput {
  const headings: HeadingNode[] = [];
  collectHeadings(detail.componentTree, headings);
  const componentCount = countNodes(detail.componentTree);
  const hasHtml =
    typeof detail.contentHtml === "string" && detail.contentHtml.trim().length > 0;

  const images = [
    ...detail.images.map((i) => ({ alt: i.alt ?? null })),
    ...detail.galleries.flatMap((g) => g.images.map((i) => ({ alt: i.alt ?? null }))),
  ];

  return {
    pageType: detail.pageType,
    title: detail.title,
    slug: detail.slug,
    pathname: detail.pathname ?? null,
    canonicalUrl: detail.canonicalUrl ?? null,
    excerpt: detail.excerpt ?? null,
    featuredImageUrl: detail.featuredImageUrl ?? null,
    seo: detail.seo
      ? {
          metaTitle: detail.seo.metaTitle ?? null,
          metaDescription: detail.seo.metaDescription ?? null,
          canonicalUrl: detail.seo.canonicalUrl ?? null,
          robots: detail.seo.robots ?? null,
          ogTitle: detail.seo.ogTitle ?? null,
          ogDescription: detail.seo.ogDescription ?? null,
          ogImage: detail.seo.ogImage ?? null,
          ogType: detail.seo.ogType ?? null,
          twitterCard: detail.seo.twitterCard ?? null,
          twitterTitle: detail.seo.twitterTitle ?? null,
          twitterDescription: detail.seo.twitterDescription ?? null,
          twitterImage: detail.seo.twitterImage ?? null,
        }
      : null,
    jsonldCount: detail.jsonld.length,
    breadcrumbCount: detail.breadcrumbs.length,
    headings,
    images,
    internalLinkCount: detail.internalLinks.length,
    externalLinks: detail.externalLinks.map((l) => ({ rel: l.rel ?? null })),
    componentCount,
    hasBody: componentCount > 0 || hasHtml,
  };
}

/**
 * Find other (non-archived) articles that collide with this one on title,
 * meta title, or meta description. Empty values never match.
 */
export async function findDuplicates(
  pageId: string,
  input: SeoValidationInput,
): Promise<DuplicateContext> {
  const ctx: DuplicateContext = {};
  const title = input.title.trim();
  const metaTitle = (input.seo?.metaTitle ?? "").trim();
  const metaDescription = (input.seo?.metaDescription ?? "").trim();

  if (title) {
    const [row] = await db
      .select({ id: pagesTable.id, slug: pagesTable.slug, title: pagesTable.title })
      .from(pagesTable)
      .where(
        and(
          ne(pagesTable.id, pageId),
          ne(pagesTable.status, "archived"),
          sql`lower(${pagesTable.title}) = lower(${title})`,
        ),
      )
      .limit(1);
    ctx.title = (row as DuplicateRef | undefined) ?? null;
  }

  if (metaTitle) {
    const [row] = await db
      .select({ id: pagesTable.id, slug: pagesTable.slug, title: pagesTable.title })
      .from(seoTable)
      .innerJoin(pagesTable, eq(seoTable.pageId, pagesTable.id))
      .where(
        and(
          ne(pagesTable.id, pageId),
          ne(pagesTable.status, "archived"),
          sql`lower(${seoTable.metaTitle}) = lower(${metaTitle})`,
        ),
      )
      .limit(1);
    ctx.metaTitle = (row as DuplicateRef | undefined) ?? null;
  }

  if (metaDescription) {
    const [row] = await db
      .select({ id: pagesTable.id, slug: pagesTable.slug, title: pagesTable.title })
      .from(seoTable)
      .innerJoin(pagesTable, eq(seoTable.pageId, pagesTable.id))
      .where(
        and(
          ne(pagesTable.id, pageId),
          ne(pagesTable.status, "archived"),
          sql`lower(${seoTable.metaDescription}) = lower(${metaDescription})`,
        ),
      )
      .limit(1);
    ctx.metaDescription = (row as DuplicateRef | undefined) ?? null;
  }

  return ctx;
}

export interface ValidationOutcome {
  detail: CmsPostDetail;
  result: SeoValidationResult;
  duplicates: DuplicateContext;
}

/**
 * Load a post, run the full validation (incl. DB duplicate detection) and
 * return the result. Returns null when the page does not exist.
 */
export async function runValidation(
  pageId: string,
): Promise<ValidationOutcome | null> {
  const detail = await serializeCmsPostDetail(pageId);
  if (!detail) return null;
  const input = buildValidationInput(detail);
  const duplicates = await findDuplicates(pageId, input);
  const result = validateSeo(input, duplicates);
  return { detail, result, duplicates };
}

/** Persist a validation result to the `validation_reports` table. */
export async function storeReport(
  pageId: string,
  result: SeoValidationResult,
  exec: Executor = db,
): Promise<void> {
  await exec.insert(validationReportsTable).values({
    pageId,
    reportType: REPORT_TYPE,
    status: result.status,
    score: result.score,
    issues: {
      checks: result.checks,
      blocking: result.blocking,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      generatedAt: new Date().toISOString(),
    },
  });
}

export interface PublishGateResult {
  ok: boolean;
  result: SeoValidationResult;
  /** Short human summary of the blocking failures (used in the 422 message). */
  summary: string;
}

/**
 * The publish gate the publish flow calls. Runs validation, ALWAYS records a
 * report row (so every publish attempt is audited), and reports whether any
 * blocking (critical) failure should stop the publish. Returns null when the
 * page does not exist.
 */
export async function runPublishGate(
  pageId: string,
): Promise<PublishGateResult | null> {
  const outcome = await runValidation(pageId);
  if (!outcome) return null;
  await storeReport(pageId, outcome.result);
  const { blocking } = outcome.result;
  const summary =
    blocking.length === 0
      ? "All critical checks passed."
      : `Publishing blocked by ${blocking.length} critical issue(s): ${blocking
          .map((c) => c.label)
          .join(", ")}.`;
  return { ok: blocking.length === 0, result: outcome.result, summary };
}

export { effectiveTitle, effectiveDescription };
