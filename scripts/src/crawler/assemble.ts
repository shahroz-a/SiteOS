import { DEFAULT_CONFIG, type CrawlerConfig } from "./config";
import { extractRaw } from "./extract";
import { buildComponentTree, buildRichText, countComponents } from "./normalize";
import type {
  ContentCounts,
  DiscoveredUrl,
  DroppedRedirect,
  ExtractedPage,
  FetchResult,
} from "./types";
import {
  canonicalizeUrl,
  classifyRedirectHop,
  classifyUrl,
  countWords,
  parentPathOf,
  sha256,
  slugFromUrl,
} from "./util";

function computeCounts(raw: ReturnType<typeof extractRaw>, components: number): ContentCounts {
  const { $, contentRoot } = raw;
  const text = contentRoot.text();
  const headings = contentRoot.find("h1,h2,h3,h4,h5,h6").length;
  const paragraphs = contentRoot.find("p").length;
  const tables = contentRoot.find("table").length;
  const lists = contentRoot.find("ul,ol").length;
  const anchors = contentRoot.find("a[href]").length;
  const ctas = contentRoot.find(
    "a.button, .btn, .cta, button, [class*='cta']",
  ).length;
  void $;
  return {
    headings,
    paragraphs,
    images: raw.images.length,
    links: raw.internalLinks.length + raw.externalLinks.length,
    tables,
    lists,
    faqs: raw.faqs.length,
    ctas,
    components,
    anchors,
    words: countWords(text),
    characters: text.replace(/\s+/g, " ").trim().length,
  };
}

/**
 * Turn a fetched page into the complete, lossless `ExtractedPage`, including
 * URL preservation, the component tree, rich text, and a content hash used for
 * idempotency/versioning.
 */
export function assemblePage(
  fetch: FetchResult,
  discovered: Pick<DiscoveredUrl, "sitemapSource" | "lastmod"> | null,
  config: CrawlerConfig = DEFAULT_CONFIG,
): ExtractedPage {
  const pageType = classifyUrl(fetch.finalUrl, discovered?.sitemapSource);
  const raw = extractRaw(fetch, pageType);

  const canonicalUrl =
    (raw.canonicalTag && canonicalizeUrl(raw.canonicalTag)) ||
    canonicalizeUrl(fetch.finalUrl) ||
    fetch.finalUrl;

  const componentTree = buildComponentTree(raw.$, raw.contentRoot);
  const richText = buildRichText(raw.$, raw.contentRoot);
  const counts = computeCounts(raw, countComponents(componentTree));

  const wordCount = counts.words;
  const readingTimeMinutes =
    raw.readingTimeMinutes ?? Math.max(1, Math.round(wordCount / config.wordsPerMinute));

  const redirectTarget =
    fetch.redirectChain.length > 0 ? fetch.finalUrl : null;

  // Filter the recorded redirect chain to hops that are safe to persist. A hop
  // is kept only when BOTH ends are sound:
  //  - its OLD path (`from`) is a clean, blog-serveable URL (same predicate as
  //    frontier expansion), and
  //  - its DESTINATION (`to`) resolves to a clean, reachable target — an on-blog
  //    page or a real Headout-origin page — not junk (embedded URLs, bare
  //    domains, map links / foreign hosts) that storage would otherwise re-host
  //    under headout.com and forward readers to a broken target.
  // Filtering here, where the destination's full URL (host included) is still
  // available, means malformed source-markup junk can never reach the redirect
  // list. The raw `fetch.redirectChain` is still used above for off-blog/loop
  // detection.
  //
  // Each dropped hop is captured (with the precise reason it failed the gate) so
  // it can be surfaced in a migration report — an editor then fixes the broken
  // source link instead of leaving readers on a dead path. `classifyRedirectHop`
  // is the single source of truth: a `null` reason means the hop is kept.
  const redirectChain: typeof fetch.redirectChain = [];
  const droppedRedirects: DroppedRedirect[] = [];
  for (const hop of fetch.redirectChain) {
    const reason = classifyRedirectHop(hop.from, hop.to);
    if (reason === null) {
      redirectChain.push(hop);
    } else {
      droppedRedirects.push({ from: hop.from, to: hop.to, status: hop.status, reason });
    }
  }

  // Content hash over the meaningful, lossless content representation.
  const contentHash = sha256(
    JSON.stringify({ title: raw.title, cleanedHtml: raw.cleanedHtml, componentTree }),
  );

  return {
    requestedUrl: fetch.requestedUrl,
    finalUrl: fetch.finalUrl,
    canonicalUrl,
    canonicalTag: raw.canonicalTag,
    slug: slugFromUrl(canonicalUrl) || slugFromUrl(fetch.finalUrl),
    pathname: new URL(canonicalUrl).pathname,
    parentPath: parentPathOf(canonicalUrl),
    trailingSlash: new URL(canonicalUrl).pathname.endsWith("/"),
    pageType,
    language: raw.language,
    httpStatus: fetch.httpStatus,
    redirectTarget,
    redirectChain,
    droppedRedirects,
    hreflang: raw.hreflang,
    sitemapSource: discovered?.sitemapSource ?? null,
    sitemapLastmod: discovered?.lastmod ?? null,

    title: raw.title,
    subtitle: raw.subtitle,
    excerpt: raw.excerpt,
    featuredImageUrl: raw.featuredImageUrl,
    featuredImageAlt: raw.featuredImageAlt,
    publishedAt: raw.publishedAt,
    modifiedAt: raw.modifiedAt,
    readingTimeMinutes,
    wordCount,

    author: raw.author,
    categories: raw.categories,
    tags: raw.tags,

    originalHtml: fetch.html,
    cleanedHtml: raw.cleanedHtml,
    richText,
    componentTree,

    images: raw.images,
    videos: raw.videos,
    internalLinks: raw.internalLinks,
    externalLinks: raw.externalLinks,
    faqs: raw.faqs,
    accordions: raw.accordions,
    breadcrumbs: raw.breadcrumbs,
    toc: raw.toc,
    jsonld: raw.jsonld,
    seo: raw.seo,
    metadata: raw.metadata,

    counts,
    contentHash,
    via: fetch.via,
  };
}
