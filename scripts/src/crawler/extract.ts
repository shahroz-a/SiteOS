import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  ExtractedAccordion,
  ExtractedBreadcrumb,
  ExtractedFaq,
  ExtractedImage,
  ExtractedLink,
  ExtractedMetadata,
  ExtractedSeo,
  ExtractedTocItem,
  ExtractedVideo,
  FetchResult,
  PageType,
} from "./types";
import {
  canonicalizeUrl,
  domainOf,
  isInternalUrl,
  normalizeWhitespace,
  parseDate,
} from "./util";

export interface RawExtraction {
  $: CheerioAPI;
  contentRoot: Cheerio<Element>;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  language: string;
  canonicalTag: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  readingTimeMinutes: number | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  author: RawExtraction["__author"];
  __author: {
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    role: string | null;
    url: string | null;
  } | null;
  categories: Array<{ name: string; slug: string; url: string | null }>;
  tags: Array<{ name: string; slug: string; url: string | null }>;
  images: ExtractedImage[];
  videos: ExtractedVideo[];
  internalLinks: ExtractedLink[];
  externalLinks: ExtractedLink[];
  faqs: ExtractedFaq[];
  accordions: ExtractedAccordion[];
  breadcrumbs: ExtractedBreadcrumb[];
  toc: ExtractedTocItem[];
  jsonld: Array<{ type: string | null; data: unknown }>;
  seo: ExtractedSeo;
  metadata: ExtractedMetadata;
  cleanedHtml: string;
}

const CONTENT_SELECTORS = [
  "article",
  "main article",
  "main .entry-content",
  ".entry-content",
  ".post-content",
  ".blog-content",
  "main",
  "#content",
];

/** Elements stripped from the cleaned content (navigation, ads, scripts). */
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header.site-header",
  "footer",
  ".newsletter-popup",
  ".cookie-banner",
  "[aria-hidden='true']",
];

function metaContent($: CheerioAPI, selector: string): string | null {
  const v = $(selector).attr("content");
  return v ? v.trim() : null;
}

function slugFromHref(href: string | undefined): string {
  if (!href) return "";
  const path = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parseJsonLd($: CheerioAPI): Array<{ type: string | null; data: unknown }> {
  const out: Array<{ type: string | null; data: unknown }> = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const type =
          node && typeof node === "object" && "@type" in node
            ? String((node as Record<string, unknown>)["@type"])
            : null;
        out.push({ type, data: node });
      }
    } catch {
      /* malformed JSON-LD is skipped but not fatal */
    }
  });
  return out;
}

function extractSeo($: CheerioAPI): ExtractedSeo {
  const keywords = metaContent($, "meta[name='keywords']");
  return {
    metaTitle: metaContent($, "meta[name='title']") ?? ($("title").first().text().trim() || null),
    metaDescription: metaContent($, "meta[name='description']"),
    canonicalUrl: $("link[rel='canonical']").attr("href")?.trim() ?? null,
    robots: metaContent($, "meta[name='robots']"),
    keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : null,
    ogTitle: metaContent($, "meta[property='og:title']"),
    ogDescription: metaContent($, "meta[property='og:description']"),
    ogImage: metaContent($, "meta[property='og:image']"),
    ogType: metaContent($, "meta[property='og:type']"),
    twitterCard: metaContent($, "meta[name='twitter:card']"),
    twitterTitle: metaContent($, "meta[name='twitter:title']"),
    twitterDescription: metaContent($, "meta[name='twitter:description']"),
    twitterImage: metaContent($, "meta[name='twitter:image']"),
  };
}

function extractMetadata($: CheerioAPI, headers: Record<string, string>): ExtractedMetadata {
  const metaTags: ExtractedMetadata["metaTags"] = [];
  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  $("meta").each((_, el) => {
    const name = $(el).attr("name");
    const property = $(el).attr("property");
    const content = $(el).attr("content");
    if (!content) return;
    metaTags.push({
      ...(name ? { name } : {}),
      ...(property ? { property } : {}),
      content,
    });
    if (property?.startsWith("og:")) openGraph[property] = content;
    if (name?.startsWith("twitter:")) twitter[name] = content;
  });
  return { metaTags, openGraph, twitter, custom: { httpHeaders: headers } };
}

function extractHreflang($: CheerioAPI): Array<{ lang: string; href: string }> {
  const out: Array<{ lang: string; href: string }> = [];
  $("link[rel='alternate'][hreflang]").each((_, el) => {
    const lang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (lang && href) out.push({ lang, href });
  });
  return out;
}

function resolveImageSrc($el: Cheerio<Element>): string | null {
  const el = $el;
  return (
    el.attr("src") ||
    el.attr("data-src") ||
    el.attr("data-lazy-src") ||
    el.attr("data-original") ||
    el.attr("srcset")?.split(",")[0]?.trim().split(" ")[0] ||
    null
  );
}

function extractImages(
  $: CheerioAPI,
  root: Cheerio<Element>,
  baseUrl: string,
): ExtractedImage[] {
  const out: ExtractedImage[] = [];
  let position = 0;
  root.find("img").each((_, el) => {
    const $img = $(el);
    const rawSrc = resolveImageSrc($img);
    if (!rawSrc) return;
    const abs = canonicalizeUrl(rawSrc, baseUrl) ?? rawSrc;
    const $fig = $img.closest("figure");
    const caption = $fig.find("figcaption").first().text().trim() || null;
    out.push({
      originalUrl: abs,
      url: abs,
      alt: $img.attr("alt")?.trim() ?? null,
      title: $img.attr("title")?.trim() ?? null,
      caption,
      width: numAttr($img.attr("width")),
      height: numAttr($img.attr("height")),
      loading: $img.attr("loading") ?? null,
      role: position === 0 ? "inline" : "inline",
      position: position++,
    });
  });
  return out;
}

function numAttr(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function extractVideos(
  $: CheerioAPI,
  root: Cheerio<Element>,
  baseUrl: string,
): ExtractedVideo[] {
  const out: ExtractedVideo[] = [];
  let position = 0;
  root.find("iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src) return;
    const abs = canonicalizeUrl(src, baseUrl) ?? src;
    let provider: string | null = null;
    if (/youtube|youtu\.be/.test(abs)) provider = "youtube";
    else if (/vimeo/.test(abs)) provider = "vimeo";
    else if (/dailymotion/.test(abs)) provider = "dailymotion";
    if (!provider && !/video|player|embed/.test(abs)) return;
    out.push({
      provider,
      originalUrl: abs,
      embedUrl: abs,
      title: $(el).attr("title")?.trim() ?? null,
      position: position++,
    });
  });
  return out;
}

function extractLinks(
  $: CheerioAPI,
  root: Cheerio<Element>,
  baseUrl: string,
): { internal: ExtractedLink[]; external: ExtractedLink[] } {
  const internal: ExtractedLink[] = [];
  const external: ExtractedLink[] = [];
  let position = 0;
  root.find("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href");
    if (!rawHref) return;
    if (rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:"))
      return;
    const abs = canonicalizeUrl(rawHref, baseUrl);
    if (!abs) return;
    const link: ExtractedLink = {
      href: abs,
      anchorText: normalizeWhitespace($(el).text()) || null,
      rel: $(el).attr("rel") ?? null,
      position: position++,
    };
    if (isInternalUrl(abs)) internal.push(link);
    else external.push(link);
  });
  return { internal, external };
}

function extractFaqs(
  $: CheerioAPI,
  root: Cheerio<Element>,
  jsonld: Array<{ type: string | null; data: unknown }>,
): ExtractedFaq[] {
  const out: ExtractedFaq[] = [];
  // Prefer the structured FAQPage JSON-LD when present.
  for (const block of jsonld) {
    const data = block.data as Record<string, unknown> | null;
    if (!data) continue;
    const type = data["@type"];
    const isFaq = type === "FAQPage" || (Array.isArray(type) && type.includes("FAQPage"));
    if (!isFaq) continue;
    const entities = data["mainEntity"];
    const list = Array.isArray(entities) ? entities : [];
    for (const q of list) {
      const qe = q as Record<string, unknown>;
      const question = typeof qe["name"] === "string" ? qe["name"] : null;
      const accepted = qe["acceptedAnswer"] as Record<string, unknown> | undefined;
      const answer = accepted && typeof accepted["text"] === "string" ? accepted["text"] : null;
      if (question && answer) {
        out.push({
          question: normalizeWhitespace(question),
          answer: normalizeWhitespace(answer),
          position: out.length,
        });
      }
    }
  }
  if (out.length > 0) return out;

  // Fall back to DOM heuristics: <details>/accordion question-answer pairs.
  root.find("details").each((_, el) => {
    const $el = $(el);
    const q = $el.find("summary").first().text().trim();
    const a = $el.clone().children("summary").remove().end().text().trim();
    if (q && a) out.push({ question: q, answer: normalizeWhitespace(a), position: out.length });
  });
  return out;
}

function extractAccordions($: CheerioAPI, root: Cheerio<Element>): ExtractedAccordion[] {
  const out: ExtractedAccordion[] = [];
  root.find("details, .accordion-item, [data-accordion-item]").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find("summary, .accordion-title, .accordion-header").first().text().trim() || null;
    const content = normalizeWhitespace(
      $el
        .clone()
        .children("summary, .accordion-title, .accordion-header")
        .remove()
        .end()
        .text(),
    );
    if (title && content) out.push({ title, content, position: out.length });
  });
  return out;
}

function extractBreadcrumbs(
  $: CheerioAPI,
  jsonld: Array<{ type: string | null; data: unknown }>,
): ExtractedBreadcrumb[] {
  const out: ExtractedBreadcrumb[] = [];
  for (const block of jsonld) {
    const data = block.data as Record<string, unknown> | null;
    if (!data) continue;
    const type = data["@type"];
    const isBc =
      type === "BreadcrumbList" || (Array.isArray(type) && type.includes("BreadcrumbList"));
    if (!isBc) continue;
    const items = data["itemListElement"];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const ie = it as Record<string, unknown>;
      const name = typeof ie["name"] === "string" ? ie["name"] : null;
      const item = ie["item"];
      let url: string | null = null;
      if (typeof item === "string") url = item;
      else if (item && typeof item === "object" && "@id" in item)
        url = String((item as Record<string, unknown>)["@id"]);
      const pos = typeof ie["position"] === "number" ? ie["position"] - 1 : out.length;
      if (name) out.push({ label: name, url, position: pos });
    }
  }
  if (out.length > 0) return out;

  // DOM fallback: a breadcrumb nav/ol.
  $("nav[aria-label*='readcrumb'] a, .breadcrumb a, .breadcrumbs a").each((_, el) => {
    const label = $(el).text().trim();
    if (label) out.push({ label, url: $(el).attr("href") ?? null, position: out.length });
  });
  return out;
}

function extractToc($: CheerioAPI, root: Cheerio<Element>): ExtractedTocItem[] {
  const out: ExtractedTocItem[] = [];
  const $toc = $(".table-of-contents, .toc, nav.toc, #toc").first();
  const scope = $toc.length ? $toc : root.find(".toc, .table-of-contents").first();
  scope.find("a[href^='#']").each((_, el) => {
    const label = $(el).text().trim();
    const anchor = $(el).attr("href")?.replace(/^#/, "") ?? null;
    if (label) out.push({ label, anchor, position: out.length });
  });
  return out;
}

function extractAuthor(
  $: CheerioAPI,
  jsonld: Array<{ type: string | null; data: unknown }>,
): RawExtraction["__author"] {
  // JSON-LD author first.
  for (const block of jsonld) {
    const data = block.data as Record<string, unknown> | null;
    if (!data) continue;
    const author = data["author"];
    const a = Array.isArray(author) ? author[0] : author;
    if (a && typeof a === "object") {
      const ae = a as Record<string, unknown>;
      const name = typeof ae["name"] === "string" ? ae["name"] : null;
      const url = typeof ae["url"] === "string" ? ae["url"] : null;
      if (name) {
        return {
          name,
          slug: slugFromHref(url ?? undefined) || slugify(name),
          bio: typeof ae["description"] === "string" ? ae["description"] : null,
          avatarUrl: typeof ae["image"] === "string" ? ae["image"] : null,
          role: null,
          url,
        };
      }
    }
  }
  // DOM fallback.
  const $a = $(".author-name, .post-author a, [rel='author']").first();
  if ($a.length) {
    const name = $a.text().trim();
    const url = $a.attr("href") ?? null;
    if (name)
      return {
        name,
        slug: slugFromHref(url ?? undefined) || slugify(name),
        bio: null,
        avatarUrl: null,
        role: null,
        url,
      };
  }
  return null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractTaxonomy(
  $: CheerioAPI,
  selector: string,
): Array<{ name: string; slug: string; url: string | null }> {
  const out: Array<{ name: string; slug: string; url: string | null }> = [];
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    const name = $(el).text().trim();
    const url = $(el).attr("href") ?? null;
    const slug = slugFromHref(url ?? undefined) || slugify(name);
    if (name && slug && !seen.has(slug)) {
      seen.add(slug);
      out.push({ name, slug, url });
    }
  });
  return out;
}

function findContentRoot($: CheerioAPI): Cheerio<Element> {
  for (const sel of CONTENT_SELECTORS) {
    const found = $(sel).first();
    if (found.length && found.text().trim().length > 200) {
      return found as Cheerio<Element>;
    }
  }
  return $("body") as Cheerio<Element>;
}

/**
 * Parse the rendered HTML of a page into the full set of structured fields.
 * `pageType` influences a few heuristics (e.g. listing vs article).
 */
export function extractRaw(fetch: FetchResult, _pageType: PageType): RawExtraction {
  const $ = cheerio.load(fetch.html);
  const baseUrl = fetch.finalUrl;

  const jsonld = parseJsonLd($);
  const seo = extractSeo($);
  const metadata = extractMetadata($, fetch.httpHeaders);
  const hreflang = extractHreflang($);

  const title =
    $("h1").first().text().trim() ||
    seo.ogTitle ||
    seo.metaTitle ||
    $("title").first().text().trim();
  const subtitle = $(".post-subtitle, .subtitle, h2.subtitle").first().text().trim() || null;
  const excerpt = seo.metaDescription ?? seo.ogDescription ?? null;
  const language = $("html").attr("lang")?.split("-")[0] ?? "en";

  const publishedAt =
    parseDate(metaContent($, "meta[property='article:published_time']")) ??
    parseDate($("time[datetime]").first().attr("datetime")) ??
    dateFromJsonLd(jsonld, "datePublished");
  const modifiedAt =
    parseDate(metaContent($, "meta[property='article:modified_time']")) ??
    dateFromJsonLd(jsonld, "dateModified");

  const readingTimeMinutes = parseReadingTime($(".reading-time, .read-time").first().text());

  const contentRoot = findContentRoot($);

  // Strip noise from a clone so cleanedHtml is content-only and lossless of meaning.
  const $clone = contentRoot.clone();
  for (const sel of NOISE_SELECTORS) $clone.find(sel).remove();
  const cleanedHtml = $.html($clone);

  const images = extractImages($, contentRoot, baseUrl);
  const videos = extractVideos($, contentRoot, baseUrl);
  const { internal, external } = extractLinks($, contentRoot, baseUrl);
  const faqs = extractFaqs($, contentRoot, jsonld);
  const accordions = extractAccordions($, contentRoot);
  const breadcrumbs = extractBreadcrumbs($, jsonld);
  const toc = extractToc($, contentRoot);
  const author = extractAuthor($, jsonld);
  const categories = extractTaxonomy(
    $,
    "a[rel='category tag'], .post-categories a, .category a",
  );
  const tags = extractTaxonomy($, "a[rel='tag'], .post-tags a, .tags a");

  const featuredImageUrl = seo.ogImage ?? images[0]?.url ?? null;
  const featuredImageAlt = images[0]?.alt ?? null;

  return {
    $,
    contentRoot,
    title: normalizeWhitespace(title) || "Untitled",
    subtitle,
    excerpt,
    language,
    canonicalTag: seo.canonicalUrl,
    hreflang,
    publishedAt,
    modifiedAt,
    readingTimeMinutes,
    featuredImageUrl,
    featuredImageAlt,
    author,
    __author: author,
    categories,
    tags,
    images,
    videos,
    internalLinks: internal,
    externalLinks: external,
    faqs,
    accordions,
    breadcrumbs,
    toc,
    jsonld,
    seo,
    metadata,
    cleanedHtml,
  };
}

function dateFromJsonLd(
  jsonld: Array<{ type: string | null; data: unknown }>,
  key: string,
): Date | null {
  for (const block of jsonld) {
    const data = block.data as Record<string, unknown> | null;
    if (data && typeof data[key] === "string") return parseDate(data[key] as string);
  }
  return null;
}

function parseReadingTime(text: string): number | null {
  const m = text.match(/(\d+)\s*min/i);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export { domainOf };
