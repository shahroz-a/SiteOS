import { useEffect } from "react";
import {
  applySeoTags,
  type SeoDocument,
  type SeoTags,
} from "@workspace/blog-seo";

/**
 * Set the document's per-route `<head>` metadata at runtime.
 *
 * The tag-building and DOM-application logic is shared with the static
 * prerender path via `@workspace/blog-seo` (`applySeoTags`), so JS-enabled
 * browsers and non-JS crawlers see an identical title / description / canonical
 * / Open Graph / Twitter / JSON-LD tag set. Do not reimplement the tag logic
 * here — edit the shared lib so both sides stay in lock-step.
 */
export function useSeo(options: SeoTags) {
  const {
    title,
    description,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    twitterCard,
    jsonLd,
  } = options;

  useEffect(() => {
    // The browser `Document` structurally satisfies the minimal `SeoDocument`
    // surface the shared applier needs.
    return applySeoTags(document as unknown as SeoDocument, options);
    // `options` is reconstructed each render; depend on its fields so the effect
    // only re-runs when the resolved metadata actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
