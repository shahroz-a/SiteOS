---
name: Headout crawl render mode (HTTP vs Playwright)
description: Evidence and decision for whether the full ~2,929-page Headout blog crawl should fetch via plain HTTP or render via Playwright.
---

# Headout crawl: HTTP vs Playwright

**Decision: crawl the full blog via plain HTTP.** Headout's blog is server-rendered (WordPress), so HTTP returns the complete article HTML; the extraction engine (`assemblePage`) produces an essentially identical structured result to a full browser render, at a fraction of the cost.

**Why (DB-free comparison via `scripts/src/crawl-compare.ts`, 3 representative URLs):**
- Article bodies are identical between HTTP and Playwright on the fields that matter for migration: component tree, headings, paragraphs, FAQs, tables, lists, internal links, CTAs, word count (±<2%). Title and cleaned HTML match.
- The ONLY consistent difference: Playwright captures a few extra **lazy-loaded images**. Article pages: +0 to +2 images. Category/listing pages: more pronounced (one example 1 → 5 images), because thumbnails only get their real `src` after scroll.
- Speed: Playwright is ~100–600× slower per page (≈12–20 s vs ≈0.03–0.1 s). At ~2,929 pages that's ~minutes (HTTP) vs ~10–16+ hours (browser), before failures/retries.
- Reliability: in the Replit env, browser rendering is fragile — `networkidle` never settles on Headout (ad/analytics stack), and some article pages stall a real browser entirely while plain HTTP returns instantly.

**How to apply:**
- Run the full crawl in HTTP mode (`--no-browser`, i.e. `config.useBrowser=false`).
- Close the lazy-image gap WITHOUT a browser by improving extraction to read lazy attrs (`data-src`, `data-lazy-src`, `data-original`, `srcset`, `<noscript><img>`). Optionally spot-render only pages whose extracted image count looks suspiciously low.
- The crawler persists to Supabase, so the full crawl is also gated on the DB being up.

**Latent bug found:** `crawler/browser.ts` `autoScroll` is unbounded — on infinite-scroll/lazy pages `document.body.scrollHeight` keeps growing so `total >= scrollHeight` may never become true and the in-page promise never resolves (hangs the render). `crawl-compare.ts` uses a bounded version (cap steps + wall-clock). If browser mode is ever used in production, bound `browser.ts`'s scroll too.
