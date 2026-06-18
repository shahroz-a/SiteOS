/**
 * Pure helpers for prerendering the blog's per-route `<head>` metadata into the
 * static HTML produced by `vite build`. These mirror the client-side `useSeo`
 * hook (`artifacts/blog/src/hooks/use-seo.ts`) exactly so that crawlers which do
 * not execute JavaScript receive the same title / description / canonical / Open
 * Graph / Twitter / JSON-LD tags the React app would set at runtime.
 *
 * Kept side-effect free (no DB, no fs) so the tag generation and HTML injection
 * can be unit tested in isolation.
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
 * escaped so a value can never close the script element early.
 */
function serializeJsonLd(block: unknown): string {
  return JSON.stringify(block).replace(/</g, "\\u003c");
}

/**
 * Render the head tags for a route as an HTML string, mirroring the order and
 * fallback logic of the `useSeo` hook. A meta tag is only emitted when its
 * content is truthy (matching `setMetaBy*`, which bail on empty content).
 */
export function renderSeoTags(tags: SeoTags): string {
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

  const lines: string[] = [];
  lines.push(`<title>${escapeText(title)}</title>`);

  if (description) {
    lines.push(`<meta name="description" content="${escapeAttr(description)}" />`);
  }
  if (canonicalUrl) {
    lines.push(`<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`);
  }

  const resolvedOgTitle = ogTitle ?? title;
  const resolvedOgDescription = ogDescription ?? description;

  lines.push(
    `<meta property="og:title" content="${escapeAttr(resolvedOgTitle)}" />`,
  );
  if (resolvedOgDescription) {
    lines.push(
      `<meta property="og:description" content="${escapeAttr(resolvedOgDescription)}" />`,
    );
  }
  lines.push(`<meta property="og:type" content="${escapeAttr(ogType)}" />`);
  if (canonicalUrl) {
    lines.push(`<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`);
  }
  if (ogImage) {
    lines.push(`<meta property="og:image" content="${escapeAttr(ogImage)}" />`);
  }

  if (twitterCard) {
    lines.push(`<meta name="twitter:card" content="${escapeAttr(twitterCard)}" />`);
  }
  lines.push(
    `<meta name="twitter:title" content="${escapeAttr(resolvedOgTitle)}" />`,
  );
  if (resolvedOgDescription) {
    lines.push(
      `<meta name="twitter:description" content="${escapeAttr(resolvedOgDescription)}" />`,
    );
  }
  if (ogImage) {
    lines.push(`<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`);
  }

  if (jsonLd && jsonLd.length > 0) {
    for (const block of jsonLd) {
      lines.push(
        `<script type="application/ld+json">${serializeJsonLd(block)}</script>`,
      );
    }
  }

  return lines.join("\n    ");
}

const TITLE_RE = /<title>[\s\S]*?<\/title>\s*/i;
const DESCRIPTION_RE = /<meta\s+name="description"[^>]*>\s*/gi;
const CANONICAL_RE = /<link\s+rel="canonical"[^>]*>\s*/gi;
const OG_RE = /<meta\s+property="og:[^"]*"[^>]*>\s*/gi;
const TWITTER_RE = /<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi;

/**
 * Replace the SEO-related tags in a built `index.html` with freshly rendered
 * ones for a specific route. Removes the template's default title, description,
 * canonical, Open Graph and Twitter tags (the `robots` meta is preserved), then
 * inserts the new block immediately before `</head>`.
 */
export function injectSeo(html: string, tags: SeoTags): string {
  let out = html
    .replace(TITLE_RE, "")
    .replace(DESCRIPTION_RE, "")
    .replace(CANONICAL_RE, "")
    .replace(OG_RE, "")
    .replace(TWITTER_RE, "");

  const block = `${renderSeoTags(tags)}\n  `;
  const headCloseIndex = out.search(/<\/head>/i);
  if (headCloseIndex === -1) {
    throw new Error("Could not find </head> in the HTML template.");
  }
  out = out.slice(0, headCloseIndex) + block + out.slice(headCloseIndex);
  return out;
}

/** A slug is only safe as a path segment if it has no separators or traversal. */
export function isSafeSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    !slug.includes("/") &&
    !slug.includes("\\") &&
    !slug.includes("..")
  );
}

/**
 * Output file paths (relative to the static publicDir) for a route. Both the
 * `<segment>.html` and `<segment>/index.html` forms are written so the static
 * file server resolves the route regardless of which clean-URL convention it
 * uses or whether the request carries a trailing slash.
 */
export function outputPathsFor(
  kind: "index" | "search" | "article" | "category" | "author",
  slug?: string,
): string[] {
  switch (kind) {
    case "index":
      return ["index.html"];
    case "search":
      return ["search.html", "search/index.html"];
    case "article":
      return [`${slug}.html`, `${slug}/index.html`];
    case "category":
      return [`category/${slug}.html`, `category/${slug}/index.html`];
    case "author":
      return [`author/${slug}.html`, `author/${slug}/index.html`];
  }
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
export function authorSeo(author: {
  name: string;
  bio?: string | null;
}): SeoTags {
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
