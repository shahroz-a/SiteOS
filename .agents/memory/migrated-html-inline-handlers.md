---
name: Migrated HTML carries mod_pagespeed inline handlers
description: Why any path that injects the migrated WordPress contentHtml must strip inline on* attributes
---

# Migrated corpus HTML carries inline event handlers

The Headout source articles were served through Google's mod_pagespeed, so the
stored raw/cleaned HTML (`pages.cleanedHtml` → API `contentHtml`) contains
`<img … onload="pagespeed.CriticalImages.checkImageForCriticality(this);"
data-pagespeed-url-hash="…">` (≈100+ such handlers in a single article).

**Rule:** any code path that injects this corpus HTML into the live DOM
(`dangerouslySetInnerHTML`, `innerHTML`, a future SSR/prerender body, or the
mobile app if it ever renders `contentHtml`) MUST strip inline `on*` attributes
first. Otherwise the browser parses the handler, it fires against a `pagespeed`
global that doesn't exist here, and throws `ReferenceError: pagespeed is not
defined` from `HTMLImageElement.onload` on every image.

**Why:** the web blog crashed exactly this way. Crawler-ingested pages store
`componentTree` as a top-level **array** (not the object shape the renderer
expects) and their `richText` isn't the `{root:{children}}` shape either, so the
article renderer falls through to the raw-`contentHtml` branch — which is the
only path that injects unsanitized corpus HTML. The structured (componentTree /
richText) paths build React elements and are safe.

**How to apply:** sanitize at the render boundary before injection (strip every
attribute whose name starts with `on`). The blog does this with a small
DOMParser-based helper (regex fallback for non-DOM env). This is NOT full HTML
sanitization — if the corpus is ever treated as genuinely untrusted, move to a
vetted allowlist sanitizer (DOMPurify) at the ingest/API boundary instead.

## The corpus carries several distinct WordPress artifacts — clean them in ONE place

`on*` handlers are not the only baked-in cruft. Known migrated-WP artifacts seen
in `contentHtml`:

- **mod_pagespeed `on*` handlers** (above).
- **"Sassy Social Share" widgets** — `heateor_sss_*` containers/anchors/spans
  (vertical + bottom sharing bars, ChatGPT/Google-News/FB/etc. icon sprites).
  Render as dead/broken icon boxes on every article.
- **Duplicated-leading-char URL schemes** — e.g. `data-src="hhttps://cdn-imgix…"`
  / `src="hhttp://…"`. The browser treats `hhttps:` as an unknown scheme →
  `ERR_UNKNOWN_URL_SCHEME` + a broken image. `hhttp`/`hhttps` is never valid, so
  the repair (drop the extra leading `h`) is unambiguous.

**Rule:** the single cleanup boundary is `prepareArticleHtml` in
`lib/blog-renderer/src/parse.ts` — a pure, isomorphic (no-DOM) string pipeline so
prerender (server) and hydrated (client) markup stay byte-identical. It chains
the per-artifact helpers (`stripSocialShare`, `fixMalformedUrlScheme`, lazy-img
repair, `on*` strip, heading-id/TOC). **Any NEW path that injects corpus
`contentHtml` must route through `prepareArticleHtml`**, not reimplement a subset
— otherwise it reintroduces one of these artifacts.

**Why:** each artifact produced a real, visible defect (the `pagespeed` crash,
broken social boxes, broken images + console errors) — and the goal is a
polished article body with no console errors. Adding the next artifact's fix as a
new helper inside `prepareArticleHtml` (with a unit test in `parse.test.ts`) keeps
every consumer fixed at once.
