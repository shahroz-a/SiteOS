/**
 * Single source of truth for the blog's per-route `<head>` metadata.
 *
 * Both the client-side `useSeo` hook (`artifacts/blog/src/hooks/use-seo.ts`)
 * and the static prerender runner (`scripts/src/prerender/seo.ts` +
 * `scripts/src/prerender-blog.ts`) derive their tags from
 * {@link buildSeoTagList} here, so crawlers that don't execute JavaScript and
 * JS-enabled browsers receive an identical title / description / canonical /
 * Open Graph / Twitter / JSON-LD tag set.
 *
 * The fallback and conditional-emission logic (e.g. `og:title` falling back to
 * `title`, omitting `og:image` when there is no image) lives ONLY in
 * {@link buildSeoTagList}. Adding a new tag kind to {@link SeoTagSpec} makes the
 * exhaustive switches in {@link renderSeoTags} and {@link applySeoTags} fail to
 * compile until both sides handle it, so the two can never silently drift.
 *
 * This module is intentionally free of DOM, React, fs and DB dependencies so it
 * can be shared by a Node prerender script and a browser hook, and unit tested
 * in isolation.
 */

export interface SeoTags {
  title: string;
  description?: string | null;
  canonicalUrl?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  ogType?: string;
  twitterCard?: string | null;
  jsonLd?: unknown[];
}

/**
 * A single resolved head tag, normalized away from any particular rendering
 * target (HTML string vs live DOM). The order of the list returned by
 * {@link buildSeoTagList} is significant and is preserved by both renderers.
 */
export type SeoTagSpec =
  | { kind: "title"; text: string }
  | { kind: "meta"; attr: "name" | "property"; key: string; content: string }
  | { kind: "link"; rel: string; href: string }
  | { kind: "jsonld"; block: unknown };

/**
 * Resolve a {@link SeoTags} value into the ordered list of head tags to emit.
 * This encodes all of the fallback rules and "only emit when truthy" behavior
 * once, so the prerender and runtime renderers stay in lock-step.
 */
export function buildSeoTagList(tags: SeoTags): SeoTagSpec[] {
  const {
    title,
    description,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImage,
    ogType = "website",
    twitterCard = "summary_large_image",
    jsonLd,
  } = tags;

  const resolvedOgTitle = ogTitle ?? title;
  const resolvedOgDescription = ogDescription ?? description;

  const specs: SeoTagSpec[] = [];
  specs.push({ kind: "title", text: title });

  if (description) {
    specs.push({ kind: "meta", attr: "name", key: "description", content: description });
  }
  if (canonicalUrl) {
    specs.push({ kind: "link", rel: "canonical", href: canonicalUrl });
  }

  specs.push({ kind: "meta", attr: "property", key: "og:title", content: resolvedOgTitle });
  if (resolvedOgDescription) {
    specs.push({
      kind: "meta",
      attr: "property",
      key: "og:description",
      content: resolvedOgDescription,
    });
  }
  specs.push({ kind: "meta", attr: "property", key: "og:type", content: ogType });
  if (canonicalUrl) {
    specs.push({ kind: "meta", attr: "property", key: "og:url", content: canonicalUrl });
  }
  if (ogImage) {
    specs.push({ kind: "meta", attr: "property", key: "og:image", content: ogImage });
  }

  if (twitterCard) {
    specs.push({ kind: "meta", attr: "name", key: "twitter:card", content: twitterCard });
  }
  specs.push({ kind: "meta", attr: "name", key: "twitter:title", content: resolvedOgTitle });
  if (resolvedOgDescription) {
    specs.push({
      kind: "meta",
      attr: "name",
      key: "twitter:description",
      content: resolvedOgDescription,
    });
  }
  if (ogImage) {
    specs.push({ kind: "meta", attr: "name", key: "twitter:image", content: ogImage });
  }

  if (jsonLd && jsonLd.length > 0) {
    for (const block of jsonLd) {
      specs.push({ kind: "jsonld", block });
    }
  }

  return specs;
}

/** Escape a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape text content for an HTML element (e.g. <title>). */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Serialize a JSON-LD block safely for inlining in a <script> tag. `<` is
 * escaped so a value can never close the script element early. (The DOM
 * renderer in {@link applySeoTags} does not need this because `textContent`
 * is never re-parsed as HTML.)
 */
function serializeJsonLd(block: unknown): string {
  return JSON.stringify(block).replace(/</g, "\\u003c");
}

function serializeSpec(spec: SeoTagSpec): string {
  switch (spec.kind) {
    case "title":
      return `<title>${escapeText(spec.text)}</title>`;
    case "meta":
      return `<meta ${spec.attr}="${spec.key}" content="${escapeAttr(spec.content)}" />`;
    case "link":
      return `<link rel="${spec.rel}" href="${escapeAttr(spec.href)}" />`;
    case "jsonld":
      return `<script type="application/ld+json">${serializeJsonLd(spec.block)}</script>`;
  }
}

/**
 * Render the head tags for a route as an HTML string (used by the static
 * prerender). Mirrors the order and fallback logic shared via
 * {@link buildSeoTagList}.
 */
export function renderSeoTags(tags: SeoTags): string {
  return buildSeoTagList(tags).map(serializeSpec).join("\n    ");
}

/**
 * Minimal structural views of the DOM that {@link applySeoTags} needs. The
 * real browser `Document` / `Element` satisfy these, and tests can supply a
 * lightweight fake. Keeping the surface tiny avoids pulling the DOM lib into
 * this otherwise environment-agnostic module.
 */
export interface SeoElement {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  textContent: string | null;
  remove(): void;
}

export interface SeoDocument {
  title: string;
  head: {
    querySelector(selectors: string): SeoElement | null;
    appendChild(child: SeoElement): void;
  };
  createElement(tagName: string): SeoElement;
}

/** Marks the head tags this module owns so re-runs update rather than duplicate. */
export const MANAGED_ATTR = "data-blog-seo";

/**
 * Apply the head tags for a route to a live document (used by the runtime
 * `useSeo` hook). Reuses previously managed `<title>`/`<meta>`/`<link>` tags so
 * route changes update in place, and appends fresh JSON-LD `<script>` tags.
 * Returns a cleanup that removes the JSON-LD scripts it created (matching the
 * previous hook behavior).
 */
export function applySeoTags(doc: SeoDocument, tags: SeoTags): () => void {
  const specs = buildSeoTagList(tags);
  const createdScripts: SeoElement[] = [];

  for (const spec of specs) {
    switch (spec.kind) {
      case "title":
        doc.title = spec.text;
        break;
      case "meta": {
        const selector = `meta[${spec.attr}="${spec.key}"][${MANAGED_ATTR}]`;
        let el = doc.head.querySelector(selector);
        if (!el) {
          el = doc.createElement("meta");
          el.setAttribute(spec.attr, spec.key);
          el.setAttribute(MANAGED_ATTR, "");
          doc.head.appendChild(el);
        }
        el.setAttribute("content", spec.content);
        break;
      }
      case "link": {
        const selector = `link[rel="${spec.rel}"][${MANAGED_ATTR}]`;
        let el = doc.head.querySelector(selector);
        if (!el) {
          el = doc.createElement("link");
          el.setAttribute("rel", spec.rel);
          el.setAttribute(MANAGED_ATTR, "");
          doc.head.appendChild(el);
        }
        el.setAttribute("href", spec.href);
        break;
      }
      case "jsonld": {
        const el = doc.createElement("script");
        el.setAttribute("type", "application/ld+json");
        el.setAttribute(MANAGED_ATTR, "");
        el.textContent = JSON.stringify(spec.block);
        doc.head.appendChild(el);
        createdScripts.push(el);
        break;
      }
    }
  }

  return () => {
    for (const el of createdScripts) el.remove();
  };
}

const SITE_DESCRIPTION =
  "Travel inspiration, family destination guides, and holiday ideas from the Headout Blog.";

/** Index (`/blog/`) SEO — mirrors `pages/Index.tsx`. */
export function indexSeo(): SeoTags {
  return {
    title: "Headout Blog — Travel inspiration & destination guides",
    description: SITE_DESCRIPTION,
  };
}

/** Search shell (`/blog/search`) SEO — mirrors `pages/Search.tsx` with no query. */
export function searchSeo(): SeoTags {
  return {
    title: "Search | Headout Blog",
    description: "Search travel guides and articles on the Headout Blog.",
  };
}

/** Category (`/blog/category/<slug>`) SEO — mirrors `pages/Category.tsx`. */
export function categorySeo(category: {
  name: string;
  description?: string | null;
}): SeoTags {
  return {
    title: `${category.name} | Headout Blog`,
    description: category.description,
  };
}

/** Author (`/blog/author/<slug>`) SEO — mirrors `pages/Author.tsx`. */
export function authorSeo(author: { name: string; bio?: string | null }): SeoTags {
  return {
    title: `${author.name} | Headout Blog`,
    description: author.bio,
  };
}

export interface ArticleSeoInput {
  title: string;
  excerpt?: string | null;
  canonicalUrl?: string | null;
  featuredImageUrl?: string | null;
  seo?: {
    metaTitle?: string | null;
    metaDescription?: string | null;
    canonicalUrl?: string | null;
    ogTitle?: string | null;
    ogDescription?: string | null;
    ogImage?: string | null;
  } | null;
  jsonLd?: unknown[];
}

/** Article (`/blog/<slug>`) SEO — mirrors `pages/Article.tsx`. */
export function articleSeo(post: ArticleSeoInput): SeoTags {
  const seo = post.seo ?? undefined;
  return {
    title: `${seo?.metaTitle ?? post.title} | Headout Blog`,
    description: seo?.metaDescription ?? post.excerpt,
    canonicalUrl: seo?.canonicalUrl ?? post.canonicalUrl,
    ogTitle: seo?.ogTitle ?? post.title,
    ogDescription: seo?.ogDescription ?? post.excerpt,
    ogImage: seo?.ogImage ?? post.featuredImageUrl,
    ogType: "article",
    jsonLd: post.jsonLd,
  };
}
