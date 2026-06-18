import { useEffect } from "react";

interface SeoOptions {
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

const MANAGED_ATTR = "data-blog-seo";

function setMetaByName(name: string, content: string | null | undefined) {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"][${MANAGED_ATTR}]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    el.setAttribute(MANAGED_ATTR, "");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaByProp(property: string, content: string | null | undefined) {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[property="${property}"][${MANAGED_ATTR}]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    el.setAttribute(MANAGED_ATTR, "");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string | null | undefined) {
  if (!href) return;
  let el = document.head.querySelector<HTMLLinkElement>(
    `link[rel="canonical"][${MANAGED_ATTR}]`,
  );
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute(MANAGED_ATTR, "");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useSeo(options: SeoOptions) {
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
  } = options;

  useEffect(() => {
    document.title = title;

    setMetaByName("description", description);
    setCanonical(canonicalUrl);

    setMetaByProp("og:title", ogTitle ?? title);
    setMetaByProp("og:description", ogDescription ?? description);
    setMetaByProp("og:type", ogType);
    if (canonicalUrl) setMetaByProp("og:url", canonicalUrl);
    setMetaByProp("og:image", ogImage);

    setMetaByName("twitter:card", twitterCard);
    setMetaByName("twitter:title", ogTitle ?? title);
    setMetaByName("twitter:description", ogDescription ?? description);
    setMetaByName("twitter:image", ogImage);

    const scripts: HTMLScriptElement[] = [];
    if (jsonLd && jsonLd.length > 0) {
      for (const block of jsonLd) {
        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.setAttribute(MANAGED_ATTR, "");
        script.textContent = JSON.stringify(block);
        document.head.appendChild(script);
        scripts.push(script);
      }
    }

    return () => {
      for (const s of scripts) s.remove();
    };
  }, [
    title,
    description,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    twitterCard,
    jsonLd,
  ]);
}
