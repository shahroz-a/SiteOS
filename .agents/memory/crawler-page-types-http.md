---
name: Navigational page types load via HTTP, not browser
description: category/author/web-story Headout blog pages don't actually need Playwright; they render server-side and load over plain HTTP.
---

# Category / author / web-story pages load fine over HTTP

The migration crawler's "these page types need browser rendering" assumption was
wrong. Categories, authors, and web stories on Headout's blog are server-rendered
WordPress like the articles, so the HTTP fetch path (`--no-browser`) stores them
without Playwright.

**Why:** Playwright/Chromium cannot launch in this environment (the bundled
chrome-headless-shell crashes). When a task says a page type "needs browser
rendering," verify by test-fetching with `scripts/src/crawler/fetcher.ts`
(`useBrowser:false`) before assuming a browser is required — most "failures" were
either transient or dead URLs, not JS-rendering gaps.

**How to apply:** For crawl "failed" items, classify by cause first:
- 404 + redirect off-blog to a product page (e.g. `/blog/web-stories/london-day-trips/`
  -> `/day-trips-london-ca-...`) = genuinely dead, exclude by design.
- Malformed frontier URLs (trailing `/-foo/`, doubled paths) = junk, exclude.
- 200 with HTML = transient at original crawl time; reset to pending
  (`status='pending', attempts=0`) and re-run a bounded `runCrawl` to store them.

Web stories have **no** dedicated `page_type` enum value — `classifyUrl` maps
`/blog/web-stories/` to `page`. To report them, count by URL pattern
(`pathname LIKE '/blog/web-stories/%'`), as `reports.ts` crawl-statistics now does.
