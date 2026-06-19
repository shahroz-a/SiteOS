/**
 * Single source of truth for turning a loaded `CmsPostDetail` into the
 * `CmsPostInput` payload that `PUT /cms/posts/{id}` expects.
 *
 * The update endpoint rewrites every nested collection wholesale, so any save
 * — even a small one like swapping the banner image — must round-trip the
 * loaded detail's categories, tags, author, SEO, FAQ, images, galleries, links
 * and breadcrumbs back into the payload. Reimplementing that mapping per client
 * (web editor, mobile editor) invites drift where one surface silently drops
 * nested content; both call this instead.
 *
 * The article BODY (`componentTree` / `contentHtml` / `richText`) is preserved
 * as-is by default so a metadata-only edit never disturbs the rendered article.
 * The block editor overrides it (rebuilding `componentTree` from its blocks and
 * nulling `contentHtml`/`richText`).
 */
import type { CmsPostDetail, CmsPostInput } from "@workspace/api-client-react";

/** Editable header metadata. Omitted keys preserve the loaded detail's value. */
export interface PostMetaPatch {
  title?: string;
  subtitle?: string | null;
  excerpt?: string | null;
  /**
   * The article's banner/hero image. When a key is omitted the loaded detail's
   * value is preserved; an explicit `null` clears the banner (no hero image).
   */
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
}

export interface BuildCmsPostInputOptions {
  /** Header metadata overrides. */
  meta?: PostMetaPatch;
  /**
   * Override the article body structure. When omitted, the loaded detail's own
   * `componentTree` is preserved unchanged.
   */
  componentTree?: CmsPostInput["componentTree"];
  /**
   * Override the legacy HTML body. When omitted, the loaded detail's own
   * `contentHtml` is preserved unchanged.
   */
  contentHtml?: CmsPostInput["contentHtml"];
  /**
   * Override the legacy Lexical body. When omitted, the loaded detail's own
   * `richText` is preserved unchanged.
   */
  richText?: CmsPostInput["richText"];
}

function pick<T>(override: T | undefined, fallback: T): T {
  return override !== undefined ? override : fallback;
}

/**
 * Build the full `CmsPostInput` for a wholesale update from a loaded detail.
 *
 * Pass only the keys you intend to change via `options.meta`; everything else
 * is round-tripped from `detail` so the PUT doesn't wipe nested content.
 */
export function buildCmsPostInput(
  detail: CmsPostDetail,
  options: BuildCmsPostInputOptions = {},
): CmsPostInput {
  const meta = options.meta ?? {};

  return {
    title: pick(meta.title, detail.title),
    slug: detail.slug,
    subtitle: pick(meta.subtitle, detail.subtitle ?? null),
    excerpt: pick(meta.excerpt, detail.excerpt ?? null),
    status: detail.status,
    language: detail.language,
    canonicalUrl: detail.canonicalUrl ?? null,
    pathname: detail.pathname ?? null,
    parentPath: detail.parentPath ?? null,
    authorId: detail.author?.id ?? null,
    primaryCategoryId: detail.primaryCategory?.id ?? null,
    categoryIds: detail.categories.map((c) => c.id),
    tagIds: detail.tags.map((t) => t.id),
    featuredImageUrl: pick(meta.featuredImageUrl, detail.featuredImageUrl ?? null),
    featuredImageAlt: pick(meta.featuredImageAlt, detail.featuredImageAlt ?? null),
    contentHtml: pick(options.contentHtml, detail.contentHtml ?? null),
    richText: pick(options.richText, detail.richText ?? null),
    componentTree: pick(options.componentTree, detail.componentTree ?? null),
    readingTimeMinutes: detail.readingTimeMinutes ?? null,
    wordCount: detail.wordCount ?? null,
    publishedAt: detail.publishedAt ?? null,
    seo: detail.seo
      ? {
          metaTitle: detail.seo.metaTitle ?? null,
          metaDescription: detail.seo.metaDescription ?? null,
          canonicalUrl: detail.seo.canonicalUrl ?? null,
          robots: detail.seo.robots ?? null,
          focusKeyword: detail.seo.focusKeyword ?? null,
          keywords: detail.seo.keywords ?? null,
          ogTitle: detail.seo.ogTitle ?? null,
          ogDescription: detail.seo.ogDescription ?? null,
          ogImage: detail.seo.ogImage ?? null,
          ogType: detail.seo.ogType ?? null,
          twitterCard: detail.seo.twitterCard ?? null,
          twitterTitle: detail.seo.twitterTitle ?? null,
          twitterDescription: detail.seo.twitterDescription ?? null,
          twitterImage: detail.seo.twitterImage ?? null,
          needsReview: detail.seo.needsReview ?? false,
        }
      : null,
    faq: detail.faq.map((f) => ({
      question: f.question,
      answer: f.answer,
      position: f.position,
    })),
    breadcrumbs: detail.breadcrumbs.map((b) => ({
      label: b.label,
      url: b.url ?? null,
      position: b.position,
    })),
    jsonld: detail.jsonld.map((j) => ({ type: j.type ?? null, data: j.data })),
    images: detail.images.map((img) => ({
      url: img.url,
      originalUrl: img.originalUrl ?? null,
      alt: img.alt ?? null,
      caption: img.caption ?? null,
      credit: img.credit ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      role: img.role ?? null,
      position: img.position,
    })),
    galleries: detail.galleries.map((g) => ({
      title: g.title ?? null,
      layout: g.layout ?? null,
      position: g.position,
      images: g.images.map((img) => ({
        url: img.url,
        originalUrl: img.originalUrl ?? null,
        alt: img.alt ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        role: img.role ?? null,
        position: img.position,
      })),
    })),
    internalLinks: detail.internalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
    externalLinks: detail.externalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
  };
}
