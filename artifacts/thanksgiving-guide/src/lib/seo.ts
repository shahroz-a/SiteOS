import { useEffect } from "react";
import type { JsonLdItem, SeoMeta } from "@workspace/api-client-react";

interface SeoOptions {
  title?: string | null;
  description?: string | null;
  canonical?: string | null;
  seo?: SeoMeta | null;
  jsonld?: JsonLdItem[];
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"][data-managed="seo"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"][data-managed="seo"]',
  );
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Apply per-post document head metadata (title, description, Open Graph,
 * Twitter) and inject JSON-LD structured data. All managed nodes are removed on
 * cleanup so navigating between posts never leaks stale tags.
 */
export function useSeo({
  title,
  description,
  canonical,
  seo,
  jsonld,
}: SeoOptions): void {
  useEffect(() => {
    const resolvedTitle = seo?.metaTitle ?? title ?? undefined;
    if (resolvedTitle) document.title = resolvedTitle;

    const resolvedDescription = seo?.metaDescription ?? description ?? undefined;
    if (resolvedDescription) setMeta("name", "description", resolvedDescription);

    if (canonical) {
      setCanonical(canonical);
      setMeta("property", "og:url", canonical);
    }

    if (seo?.ogTitle) setMeta("property", "og:title", seo.ogTitle);
    if (seo?.ogDescription)
      setMeta("property", "og:description", seo.ogDescription);
    if (seo?.ogImage) setMeta("property", "og:image", seo.ogImage);
    if (seo?.twitterCard) setMeta("name", "twitter:card", seo.twitterCard);
    if (seo?.twitterTitle) setMeta("name", "twitter:title", seo.twitterTitle);
    if (seo?.twitterDescription)
      setMeta("name", "twitter:description", seo.twitterDescription);
    if (seo?.twitterImage) setMeta("name", "twitter:image", seo.twitterImage);

    const scripts: HTMLScriptElement[] = [];
    for (const item of jsonld ?? []) {
      if (!item?.data) continue;
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-managed", "seo");
      script.textContent = JSON.stringify(item.data);
      document.head.appendChild(script);
      scripts.push(script);
    }

    return () => {
      for (const script of scripts) script.remove();
      document.head
        .querySelectorAll(
          'meta[data-managed="seo"], link[rel="canonical"][data-managed="seo"]',
        )
        .forEach((el) => el.remove());
    };
  }, [title, description, canonical, seo, jsonld]);
}
