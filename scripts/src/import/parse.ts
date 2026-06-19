import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type {
  BlockNode,
  FetchResult,
  ParsedBreadcrumb,
  ParsedFaq,
  ParsedImage,
  ParsedJsonld,
  ParsedLink,
  ParsedPage,
  ParsedTaxonomy,
} from "./types";
import {
  canonicalizeUrl,
  domainOf,
  lastPathSegment,
  normalizeWhitespace,
  parentPathOf,
  parseDate,
  sha256,
  slugify,
  titleFromSlug,
} from "./util";
import { buildComponentTree, buildRichText } from "./transform";
import { createAnchorAllocator } from "../anchors";

type MetaMap = Map<string, string>;

function readMeta($: CheerioAPI): MetaMap {
  const map: MetaMap = new Map();
  $("head meta").each((_, el) => {
    const $el = $(el);
    const key = $el.attr("property") ?? $el.attr("name");
    const content = $el.attr("content");
    if (key && content != null) map.set(key.toLowerCase(), content);
  });
  return map;
}

/** Parse every <script type="application/ld+json"> block, flattening arrays/graphs. */
function readJsonld($: CheerioAPI): ParsedJsonld[] {
  const out: ParsedJsonld[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const entries: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed["@graph"])
        ? (parsed["@graph"] as unknown[])
        : [parsed];
    for (const entry of entries) {
      const type = isRecord(entry)
        ? typeof entry["@type"] === "string"
          ? (entry["@type"] as string)
          : Array.isArray(entry["@type"])
            ? String((entry["@type"] as unknown[])[0])
            : null
        : null;
      out.push({ type, data: entry });
    }
  });
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findJsonldByType(
  jsonld: ParsedJsonld[],
  type: string,
): Record<string, unknown> | null {
  const hit = jsonld.find((j) => j.type === type);
  return hit && isRecord(hit.data) ? hit.data : null;
}

function extractBreadcrumbs(jsonld: ParsedJsonld[]): ParsedBreadcrumb[] {
  const node = findJsonldByType(jsonld, "BreadcrumbList");
  if (!node || !Array.isArray(node.itemListElement)) return [];
  const out: ParsedBreadcrumb[] = [];
  for (const raw of node.itemListElement as unknown[]) {
    if (!isRecord(raw)) continue;
    const item = raw.item;
    let label = "";
    let url: string | null = null;
    if (isRecord(item)) {
      label = typeof item.name === "string" ? item.name : "";
      url = typeof item["@id"] === "string" ? item["@id"] : null;
    } else if (typeof raw.name === "string") {
      label = raw.name;
      url = typeof raw.item === "string" ? raw.item : null;
    }
    const position =
      typeof raw.position === "number" ? raw.position : out.length + 1;
    if (label) out.push({ position, label, url });
  }
  return out;
}

/** FAQ from JSON-LD FAQPage if present. */
function extractFaq(jsonld: ParsedJsonld[]): ParsedFaq[] {
  const node = findJsonldByType(jsonld, "FAQPage");
  if (!node || !Array.isArray(node.mainEntity)) return [];
  const out: ParsedFaq[] = [];
  (node.mainEntity as unknown[]).forEach((raw, i) => {
    if (!isRecord(raw)) return;
    const question = typeof raw.name === "string" ? raw.name : "";
    const accepted = raw.acceptedAnswer;
    const answer =
      isRecord(accepted) && typeof accepted.text === "string"
        ? normalizeWhitespace(stripTags(accepted.text))
        : "";
    if (question && answer) out.push({ question, answer, position: i });
  });
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Categories + tags from the WordPress <article> class list, named via links. */
function extractTaxonomy(
  $: CheerioAPI,
  pageOrigin: string,
): {
  categories: ParsedTaxonomy[];
  tags: ParsedTaxonomy[];
  primaryCategorySlug: string | null;
} {
  const article = $("article").first();
  const classes = (article.attr("class") ?? "").split(/\s+/);

  // Build slug -> display-name lookups from taxonomy links anywhere on the page.
  const nameBySlug = new Map<string, { name: string; url: string }>();
  $('a[href*="/blog/category/"], a[href*="/blog/tag/"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = normalizeWhitespace($(el).text());
    if (!href || !text) return;
    const slug = lastPathSegment(new URL(href, pageOrigin).pathname);
    if (slug && !nameBySlug.has(slug))
      nameBySlug.set(slug, { name: text, url: href });
  });

  const categories: ParsedTaxonomy[] = [];
  const tags: ParsedTaxonomy[] = [];
  for (const cls of classes) {
    if (cls.startsWith("category-")) {
      const slug = cls.slice("category-".length);
      if (!slug) continue;
      const meta = nameBySlug.get(slug);
      categories.push({
        name: meta?.name ?? titleFromSlug(slug),
        slug,
        originalUrl: meta?.url ?? `${pageOrigin}/blog/category/${slug}/`,
      });
    } else if (cls.startsWith("tag-")) {
      const slug = cls.slice("tag-".length);
      if (!slug) continue;
      const meta = nameBySlug.get(slug);
      tags.push({
        name: meta?.name ?? titleFromSlug(slug),
        slug,
        originalUrl: meta?.url ?? `${pageOrigin}/blog/tag/${slug}/`,
      });
    }
  }
  return {
    categories,
    tags,
    primaryCategorySlug: categories[0]?.slug ?? null,
  };
}

function extractAuthor(
  $: CheerioAPI,
  meta: MetaMap,
  pageOrigin: string,
): ParsedPage["author"] {
  const link = $('a[href*="/blog/author/"]').first();
  const href = link.attr("href") ?? null;
  let slug = "";
  let name = normalizeWhitespace(link.text());
  if (href) slug = lastPathSegment(new URL(href, pageOrigin).pathname);
  if (!name) name = meta.get("author") ?? "";
  if (!slug && name) slug = slugify(name);
  if (!name && slug) name = titleFromSlug(slug);
  if (!name && !slug) return null;

  const bio =
    normalizeWhitespace($(".post-author .author-bio, .author-description").text()) ||
    null;
  const avatar =
    $(".post-author img, .author-avatar img").first().attr("src") ?? null;
  return {
    name,
    slug: slug || slugify(name),
    bio: bio || null,
    avatarUrl: avatar,
    role: null,
    originalUrl: href ? new URL(href, pageOrigin).toString() : null,
  };
}

/** Remove non-content cruft from a cloned content subtree. */
function stripNonContent($: CheerioAPI, container: ReturnType<CheerioAPI>): void {
  container
    .find(
      "script, style, noscript, ins, iframe, .saswp-schema-markup-output, .sharedaddy, .jp-relatedposts, .code-block, .adsbygoogle, .post-tags, .post-share, [class*='advert'], [class*='newsletter']",
    )
    .remove();
}

function absolutize(src: string | undefined, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function extractImages(
  $: CheerioAPI,
  content: ReturnType<CheerioAPI>,
  base: string,
  featuredUrl: string | null,
  featuredAlt: string | null,
): ParsedImage[] {
  const images: ParsedImage[] = [];
  const seen = new Set<string>();
  let position = 0;
  if (featuredUrl) {
    images.push({
      originalUrl: featuredUrl,
      url: featuredUrl,
      alt: featuredAlt,
      title: null,
      caption: null,
      credit: null,
      width: null,
      height: null,
      mimeType: null,
      role: "featured",
      position: position++,
    });
    seen.add(featuredUrl);
  }
  content.find("img").each((_, el) => {
    const $img = $(el);
    const raw =
      $img.attr("data-src") ??
      $img.attr("data-lazy-src") ??
      $img.attr("src") ??
      undefined;
    const url = absolutize(raw, base);
    if (!url || seen.has(url) || url.startsWith("data:")) return;
    seen.add(url);
    const widthAttr = $img.attr("width");
    const heightAttr = $img.attr("height");
    const caption =
      normalizeWhitespace($img.closest("figure").find("figcaption").text()) ||
      null;
    images.push({
      originalUrl: url,
      url,
      alt: $img.attr("alt") ?? null,
      title: $img.attr("title") ?? null,
      caption,
      credit: null,
      width: widthAttr ? Number(widthAttr) || null : null,
      height: heightAttr ? Number(heightAttr) || null : null,
      mimeType: null,
      role: "inline",
      position: position++,
    });
  });
  return images;
}

function extractLinks(
  $: CheerioAPI,
  content: ReturnType<CheerioAPI>,
  base: string,
): { internal: ParsedLink[]; external: ParsedLink[] } {
  const baseHost = new URL(base).hostname.replace(/^www\./, "");
  const internal: ParsedLink[] = [];
  const external: ParsedLink[] = [];
  let iPos = 0;
  let ePos = 0;
  const seenInternal = new Set<string>();
  content.find("a[href]").each((_, el) => {
    const $a = $(el);
    const rawHref = $a.attr("href");
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:"))
      return;
    let abs: string;
    try {
      abs = new URL(rawHref, base).toString();
    } catch {
      return;
    }
    const host = domainOf(abs);
    if (!host) return;
    const anchorText = normalizeWhitespace($a.text()) || null;
    const rel = $a.attr("rel") ?? null;
    if (host === baseHost) {
      const canon = canonicalizeUrl(abs) ?? abs;
      if (seenInternal.has(canon)) return;
      seenInternal.add(canon);
      internal.push({ href: canon, anchorText, rel, position: iPos++ });
    } else {
      external.push({
        href: abs,
        anchorText,
        rel,
        domain: host,
        position: ePos++,
      });
    }
  });
  return { internal, external };
}

/**
 * Walk the cleaned content's top-level children into an ordered, nested block
 * tree. Headings (h2/h3) open a section; following paragraphs/lists/images/
 * quotes nest inside it. Content before the first heading sits at the root.
 */
function buildBlocks(
  $: CheerioAPI,
  content: ReturnType<CheerioAPI>,
  base: string,
): BlockNode[] {
  const roots: BlockNode[] = [];
  let current: BlockNode | null = null;
  const allocAnchor = createAnchorAllocator();

  const push = (node: BlockNode) => {
    if (current) (current.children ??= []).push(node);
    else roots.push(node);
  };

  const handle = (el: Element) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (!tag) return;
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const text = normalizeWhitespace($el.text());
      if (!text) return;
      const level = Number(tag.slice(1));
      if (level <= 3) {
        current = {
          blockType: "section",
          anchorId: allocAnchor(slugify(text)),
          data: { heading: text, level },
          children: [],
        };
        roots.push(current);
      } else {
        push({
          blockType: "heading",
          text,
          anchorId: allocAnchor(slugify(text)),
          data: { level },
        });
      }
      return;
    }
    if (tag === "p") {
      const text = normalizeWhitespace($el.text());
      if (text) push({ blockType: "paragraph", text });
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      $el.children("li").each((_, li) => {
        const t = normalizeWhitespace($(li).text());
        if (t) items.push(t);
      });
      if (items.length)
        push({ blockType: "list", data: { ordered: tag === "ol", items } });
      return;
    }
    if (tag === "blockquote") {
      const text = normalizeWhitespace($el.text());
      if (text) push({ blockType: "quote", text });
      return;
    }
    if (tag === "figure" || tag === "img") {
      const $img = tag === "img" ? $el : $el.find("img").first();
      const src = absolutize(
        $img.attr("data-src") ?? $img.attr("src"),
        base,
      );
      if (src)
        push({
          blockType: "image",
          data: {
            url: src,
            alt: $img.attr("alt") ?? null,
            caption:
              normalizeWhitespace($el.find("figcaption").text()) || null,
          },
        });
      return;
    }
    if (tag === "div" || tag === "section") {
      // Recurse into wrapper divs so nested content is not lost.
      $el.children().each((_, child) => handle(child as Element));
    }
  };

  content.children().each((_, el) => handle(el as Element));
  return roots;
}

function readingStats(text: string): { words: number; minutes: number } {
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
}

/**
 * Parse a fetched Headout (WordPress) blog page into a fully-populated
 * ParsedPage. The original HTML is preserved verbatim; everything else is
 * derived so a future parser change can be re-run from `originalHtml`.
 */
export function parsePage(fetched: FetchResult): ParsedPage {
  const html = fetched.html;
  const $ = cheerio.load(html);
  const meta = readMeta($);

  const baseForUrls = fetched.finalUrl || fetched.url;
  const pageOrigin = new URL(baseForUrls).origin;

  const ogUrl = meta.get("og:url");
  const canonicalHref =
    $('link[rel="canonical"]').attr("href") ?? ogUrl ?? baseForUrls;
  const canonicalUrl = canonicalizeUrl(canonicalHref) ?? canonicalHref;
  const pathname = new URL(canonicalUrl).pathname;
  const slug = lastPathSegment(pathname) || slugify(meta.get("og:title") ?? "");

  const title =
    meta.get("og:title") ??
    normalizeWhitespace($("h1").first().text()) ??
    normalizeWhitespace($("title").text());
  const excerpt =
    meta.get("description") ?? meta.get("og:description") ?? null;

  const jsonld = readJsonld($);
  const breadcrumbs = extractBreadcrumbs(jsonld);
  const faq = extractFaq(jsonld);
  const { categories, tags, primaryCategorySlug } = extractTaxonomy(
    $,
    pageOrigin,
  );
  const author = extractAuthor($, meta, pageOrigin);

  const featuredImageUrl = meta.get("og:image") ?? null;
  const featuredImageAlt = title || null;

  // Build a cleaned clone of the article content.
  let contentSel = $(".post-content.entry-content").first();
  if (contentSel.length === 0) contentSel = $(".entry-content").first();
  if (contentSel.length === 0) contentSel = $("article").first();
  const content = contentSel.clone();
  stripNonContent($, content);

  const cleanedHtml = normalizeWhitespace(content.html() ?? "")
    // keep tag structure but collapse the inter-tag whitespace noise
    .replace(/>\s+</g, "><");
  const contentText = normalizeWhitespace(content.text());
  const { words, minutes } = readingStats(contentText);

  const images = extractImages(
    $,
    content,
    baseForUrls,
    featuredImageUrl,
    featuredImageAlt,
  );
  const { internal, external } = extractLinks($, content, baseForUrls);
  const blocks = buildBlocks($, content, baseForUrls);
  const richText = buildRichText(blocks, title);
  const componentTree = buildComponentTree(blocks);

  const publishedAt =
    parseDate(meta.get("article:published_time")) ??
    parseDate(blogPostingDate(jsonld, "datePublished"));
  const modifiedAt =
    parseDate(meta.get("article:modified_time")) ??
    parseDate(blogPostingDate(jsonld, "dateModified"));

  const hreflang: Array<{ lang: string; href: string }> = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (lang && href) hreflang.push({ lang, href });
  });

  const metaTags: Array<{ name?: string; property?: string; content?: string }> =
    [];
  $("head meta").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    const property = $el.attr("property");
    const contentAttr = $el.attr("content");
    if ((name || property) && contentAttr != null)
      metaTags.push({
        ...(name ? { name } : {}),
        ...(property ? { property } : {}),
        content: contentAttr,
      });
  });

  const openGraph: Record<string, unknown> = {};
  const twitter: Record<string, unknown> = {};
  for (const [k, v] of meta) {
    if (k.startsWith("og:") || k.startsWith("article:")) openGraph[k] = v;
    if (k.startsWith("twitter:")) twitter[k] = v;
  }

  const language =
    $("html").attr("lang")?.split("-")[0] ?? meta.get("og:locale")?.slice(0, 2) ??
    "en";

  const contentHash = sha256(cleanedHtml || html);

  return {
    url: fetched.url,
    canonicalUrl,
    slug,
    pathname,
    parentPath: parentPathOf(pathname),
    permalink: canonicalUrl,
    trailingSlash: pathname.endsWith("/"),
    canonicalTag: canonicalHref,
    hreflang,
    language,
    status: "published",
    pageType: "post",
    title,
    subtitle: null,
    excerpt,
    author,
    categories,
    primaryCategorySlug,
    tags,
    featuredImageUrl,
    featuredImageAlt,
    images,
    originalHtml: html,
    cleanedHtml,
    richText,
    componentTree,
    blocks,
    readingTimeMinutes: minutes,
    wordCount: words,
    publishedAt,
    modifiedAt,
    sitemapLastmod: modifiedAt ?? publishedAt,
    breadcrumbs,
    faq,
    jsonld,
    internalLinks: internal,
    externalLinks: external,
    seo: {
      metaTitle: title,
      metaDescription: excerpt,
      canonicalUrl,
      robots: meta.get("robots") ?? null,
      focusKeyword: tags[0]?.slug ?? null,
      keywords: tags.map((t) => t.slug),
      ogTitle: meta.get("og:title") ?? null,
      ogDescription: meta.get("og:description") ?? null,
      ogImage: meta.get("og:image") ?? null,
      ogType: meta.get("og:type") ?? null,
      twitterCard: meta.get("twitter:card") ?? null,
      twitterTitle: meta.get("twitter:title") ?? null,
      twitterDescription: meta.get("twitter:description") ?? null,
      twitterImage: meta.get("twitter:image") ?? null,
    },
    metadata: {
      metaTags,
      httpHeaders: fetched.headers,
      openGraph,
      twitter,
      custom: null,
    },
    httpStatus: fetched.httpStatus,
    contentHash,
  };
}

function blogPostingDate(
  jsonld: ParsedJsonld[],
  key: "datePublished" | "dateModified",
): string | null {
  for (const j of jsonld) {
    if (!isRecord(j.data)) continue;
    const v = j.data[key];
    if (typeof v === "string") return v;
  }
  return null;
}

// Re-export so the CLI can discover blog links from a page without re-parsing.
export function discoverBlogLinks(
  page: ParsedPage,
  origin: string,
): string[] {
  const out = new Set<string>();
  for (const link of page.internalLinks) {
    if (
      link.href.startsWith(`${origin}/blog/`) &&
      !/\/blog\/(category|tag|author|page)\//.test(link.href)
    ) {
      out.add(link.href);
    }
  }
  return [...out];
}
