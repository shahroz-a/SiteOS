/**
 * Pure, DB-free SEO + publish validation engine.
 *
 * `validateSeo(input, duplicates)` runs a fixed catalogue of per-check rules
 * over an article's metadata + structure and returns per-check results, an
 * overall score (0-100) and the subset of failed `error`-severity checks that
 * BLOCK publishing. The same function is consumed by:
 *   - the api-server publish gate + `GET /cms/posts/:id/validation` endpoint
 *   - the CMS SEO panel (live, instant field-level feedback as the editor types)
 * so the client and server can never drift on what "valid" means.
 *
 * This module intentionally owns NO tag/preview rendering — the SEO panel's
 * Google/social previews are built from `@workspace/blog-seo` (`articleSeo` /
 * `buildSeoTagList`). Keep that boundary: tag logic lives in blog-seo, rule
 * logic lives here.
 */

export type CheckSeverity = "error" | "warn" | "info";

export type CheckCategory =
  | "url"
  | "metadata"
  | "social"
  | "structured"
  | "content"
  | "media"
  | "links";

export interface SeoCheck {
  /** Stable identifier (used as a React key + for tests). */
  id: string;
  label: string;
  category: CheckCategory;
  severity: CheckSeverity;
  passed: boolean;
  /** Human-readable explanation shown in the panel / report. */
  message: string;
}

export type ValidationStatus = "pass" | "warn" | "fail";

export interface SeoValidationResult {
  checks: SeoCheck[];
  /** 0-100, penalty-based; higher is better. */
  score: number;
  status: ValidationStatus;
  /** Failed `error`-severity checks — a non-empty list blocks publishing. */
  blocking: SeoCheck[];
  passedCount: number;
  totalCount: number;
}

/** A heading extracted from the article body, in document order. */
export interface HeadingNode {
  level: number;
  text: string;
}

export interface SeoFields {
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
}

export interface SeoValidationInput {
  pageType: string;
  title: string;
  slug: string;
  pathname: string | null;
  canonicalUrl: string | null;
  excerpt: string | null;
  featuredImageUrl: string | null;
  seo: SeoFields | null;
  /** Number of JSON-LD blocks attached to the article. */
  jsonldCount: number;
  breadcrumbCount: number;
  headings: HeadingNode[];
  /** Article images (gallery + inline + featured), each with its alt text. */
  images: { alt: string | null }[];
  internalLinkCount: number;
  externalLinks: { rel: string | null }[];
  /** Number of top-level + nested content blocks in the componentTree. */
  componentCount: number;
  /** True when the article has renderable body content (tree or legacy HTML). */
  hasBody: boolean;
}

/** A page that collides with this one on a unique-ish SEO field. */
export interface DuplicateRef {
  id: string;
  slug: string;
  title: string;
}

export interface DuplicateContext {
  title?: DuplicateRef | null;
  metaTitle?: DuplicateRef | null;
  metaDescription?: DuplicateRef | null;
}

/* ------------------------------------------------------------------ */
/* Recommended length bands (Google-ish).                              */
/* ------------------------------------------------------------------ */

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESC_MIN = 70;
export const DESC_MAX = 160;

/** Penalty (in points) deducted from 100 for a failed check, by severity. */
const PENALTY: Record<CheckSeverity, number> = {
  error: 18,
  warn: 7,
  info: 2,
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** The title search engines will show: explicit meta title else the H1/title. */
export function effectiveTitle(input: SeoValidationInput): string {
  return clean(input.seo?.metaTitle) || clean(input.title);
}

/** The description search engines will show: meta description else excerpt. */
export function effectiveDescription(input: SeoValidationInput): string {
  return clean(input.seo?.metaDescription) || clean(input.excerpt);
}

/** The canonical URL in effect: explicit SEO override else the page canonical. */
export function effectiveCanonical(input: SeoValidationInput): string {
  return clean(input.seo?.canonicalUrl) || clean(input.canonicalUrl);
}

/** The social share image in effect: explicit OG image else featured image. */
export function effectiveOgImage(input: SeoValidationInput): string {
  return clean(input.seo?.ogImage) || clean(input.featuredImageUrl);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Walk the headings and report the first hierarchy problem:
 * - more than one H1, or
 * - a skipped level (e.g. H2 → H4).
 * Returns null when the outline is well-formed (or empty).
 */
function headingHierarchyIssue(headings: HeadingNode[]): string | null {
  if (headings.length === 0) return null;
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) return `Found ${h1Count} H1 headings — use exactly one.`;
  let prev = 0;
  for (const h of headings) {
    if (prev !== 0 && h.level > prev + 1) {
      return `Heading level jumps from H${prev} to H${h.level} ("${h.text.slice(0, 40)}").`;
    }
    prev = h.level;
  }
  return null;
}

/**
 * Run the full validation catalogue.
 *
 * `duplicates` is optional: the client computes everything else instantly and
 * folds in DB-derived duplicate refs once the server validation has loaded.
 */
export function validateSeo(
  input: SeoValidationInput,
  duplicates: DuplicateContext = {},
): SeoValidationResult {
  const checks: SeoCheck[] = [];
  const add = (c: SeoCheck) => checks.push(c);

  const title = effectiveTitle(input);
  const description = effectiveDescription(input);
  const canonical = effectiveCanonical(input);
  const ogImage = effectiveOgImage(input);
  const robots = clean(input.seo?.robots).toLowerCase();

  /* --- URL / slug / canonical ----------------------------------- */
  const slug = clean(input.slug);
  add({
    id: "slug-valid",
    label: "URL slug",
    category: "url",
    severity: "error",
    passed: slug.length > 0 && SLUG_RE.test(slug),
    message:
      slug.length === 0
        ? "The article has no URL slug."
        : SLUG_RE.test(slug)
          ? `Slug "${slug}" is well-formed.`
          : `Slug "${slug}" should be lowercase words separated by single hyphens.`,
  });
  add({
    id: "canonical-present",
    label: "Canonical URL",
    category: "url",
    severity: "error",
    passed: canonical.length > 0,
    message: canonical.length > 0 ? "Canonical URL is set." : "Missing canonical URL.",
  });
  add({
    id: "canonical-absolute",
    label: "Canonical is absolute",
    category: "url",
    severity: "warn",
    passed: canonical.length === 0 || /^https?:\/\//i.test(canonical),
    message: /^https?:\/\//i.test(canonical)
      ? "Canonical URL is absolute."
      : "Canonical URL should be an absolute https:// URL.",
  });

  /* --- Title / description metadata ------------------------------ */
  add({
    id: "title-present",
    label: "SEO title",
    category: "metadata",
    severity: "error",
    passed: title.length > 0,
    message: title.length > 0 ? "A title is set." : "Missing SEO title.",
  });
  add({
    id: "title-length",
    label: "Title length",
    category: "metadata",
    severity: "warn",
    passed: title.length === 0 || (title.length >= TITLE_MIN && title.length <= TITLE_MAX),
    message:
      title.length === 0
        ? "No title to measure."
        : title.length < TITLE_MIN
          ? `Title is ${title.length} chars — aim for ${TITLE_MIN}–${TITLE_MAX}.`
          : title.length > TITLE_MAX
            ? `Title is ${title.length} chars — may be truncated (keep ≤ ${TITLE_MAX}).`
            : `Title length (${title.length}) is in range.`,
  });
  add({
    id: "description-present",
    label: "Meta description",
    category: "metadata",
    severity: "error",
    passed: description.length > 0,
    message: description.length > 0 ? "A meta description is set." : "Missing meta description.",
  });
  add({
    id: "description-length",
    label: "Description length",
    category: "metadata",
    severity: "warn",
    passed:
      description.length === 0 ||
      (description.length >= DESC_MIN && description.length <= DESC_MAX),
    message:
      description.length === 0
        ? "No description to measure."
        : description.length < DESC_MIN
          ? `Description is ${description.length} chars — aim for ${DESC_MIN}–${DESC_MAX}.`
          : description.length > DESC_MAX
            ? `Description is ${description.length} chars — may be truncated (keep ≤ ${DESC_MAX}).`
            : `Description length (${description.length}) is in range.`,
  });
  add({
    id: "robots-indexable",
    label: "Indexable",
    category: "metadata",
    severity: "info",
    passed: !robots.includes("noindex"),
    message: robots.includes("noindex")
      ? "Robots is set to noindex — this article will not be indexed."
      : "Article is indexable.",
  });

  /* --- Duplicates (DB-derived) ---------------------------------- */
  add({
    id: "duplicate-title",
    label: "Unique title",
    category: "metadata",
    severity: "warn",
    passed: !duplicates.title,
    message: duplicates.title
      ? `Title duplicates "${duplicates.title.slug}".`
      : "Title is unique across articles.",
  });
  add({
    id: "duplicate-meta-title",
    label: "Unique SEO title",
    category: "metadata",
    severity: "warn",
    passed: !duplicates.metaTitle,
    message: duplicates.metaTitle
      ? `SEO title duplicates "${duplicates.metaTitle.slug}".`
      : "SEO title is unique.",
  });
  add({
    id: "duplicate-meta-description",
    label: "Unique description",
    category: "metadata",
    severity: "warn",
    passed: !duplicates.metaDescription,
    message: duplicates.metaDescription
      ? `Meta description duplicates "${duplicates.metaDescription.slug}".`
      : "Meta description is unique.",
  });

  /* --- Social / Open Graph -------------------------------------- */
  add({
    id: "og-image",
    label: "Social image",
    category: "social",
    severity: "warn",
    passed: ogImage.length > 0,
    message: ogImage.length > 0
      ? "A social/Open Graph image is set."
      : "No Open Graph image — set one or a featured image for rich social cards.",
  });
  add({
    id: "twitter-card",
    label: "Twitter card",
    category: "social",
    severity: "info",
    passed: clean(input.seo?.twitterCard).length > 0,
    message: clean(input.seo?.twitterCard).length > 0
      ? "Twitter card type is set."
      : "No Twitter card type — defaults will be used.",
  });

  /* --- Structured data ----------------------------------------- */
  add({
    id: "jsonld-present",
    label: "Schema / JSON-LD",
    category: "structured",
    severity: "warn",
    passed: input.jsonldCount > 0,
    message: input.jsonldCount > 0
      ? `${input.jsonldCount} JSON-LD block(s) present.`
      : "No JSON-LD schema — add structured data for rich results.",
  });
  add({
    id: "breadcrumbs-present",
    label: "Breadcrumbs",
    category: "structured",
    severity: "warn",
    passed: input.breadcrumbCount > 0,
    message: input.breadcrumbCount > 0
      ? `${input.breadcrumbCount} breadcrumb level(s) present.`
      : "No breadcrumbs — add them for clearer hierarchy in search results.",
  });

  /* --- Content structure --------------------------------------- */
  add({
    id: "has-body",
    label: "Body content",
    category: "content",
    severity: "error",
    passed: input.hasBody && input.componentCount > 0,
    message:
      input.hasBody && input.componentCount > 0
        ? `Article has ${input.componentCount} content block(s).`
        : "Article has no body content.",
  });
  const hierarchyIssue = headingHierarchyIssue(input.headings);
  add({
    id: "heading-hierarchy",
    label: "Heading hierarchy",
    category: "content",
    severity: "warn",
    passed: hierarchyIssue === null,
    message: hierarchyIssue ?? "Heading outline is well-formed.",
  });
  add({
    id: "has-headings",
    label: "Section headings",
    category: "content",
    severity: "info",
    passed: input.headings.length > 0,
    message: input.headings.length > 0
      ? `${input.headings.length} heading(s) structure the article.`
      : "No section headings — long articles read better with headings.",
  });

  /* --- Media --------------------------------------------------- */
  const missingAlt = input.images.filter((img) => clean(img.alt).length === 0).length;
  add({
    id: "images-alt",
    label: "Image alt text",
    category: "media",
    severity: "warn",
    passed: missingAlt === 0,
    message:
      input.images.length === 0
        ? "No images to check."
        : missingAlt === 0
          ? `All ${input.images.length} image(s) have alt text.`
          : `${missingAlt} of ${input.images.length} image(s) are missing alt text.`,
  });

  /* --- Links --------------------------------------------------- */
  const externalNoRel = input.externalLinks.filter((l) => clean(l.rel).length === 0).length;
  add({
    id: "external-rel",
    label: "External link rel",
    category: "links",
    severity: "info",
    passed: externalNoRel === 0,
    message:
      input.externalLinks.length === 0
        ? "No external links."
        : externalNoRel === 0
          ? "All external links carry a rel attribute."
          : `${externalNoRel} external link(s) have no rel (consider nofollow/noopener).`,
  });
  add({
    id: "internal-links",
    label: "Internal links",
    category: "links",
    severity: "info",
    passed: input.internalLinkCount > 0,
    message: input.internalLinkCount > 0
      ? `${input.internalLinkCount} internal link(s) aid discovery.`
      : "No internal links — link to related articles for SEO.",
  });

  const blocking = checks.filter((c) => !c.passed && c.severity === "error");
  const passedCount = checks.filter((c) => c.passed).length;

  let penalty = 0;
  for (const c of checks) {
    if (!c.passed) penalty += PENALTY[c.severity];
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const status: ValidationStatus =
    blocking.length > 0 ? "fail" : checks.some((c) => !c.passed && c.severity === "warn") ? "warn" : "pass";

  return {
    checks,
    score,
    status,
    blocking,
    passedCount,
    totalCount: checks.length,
  };
}
