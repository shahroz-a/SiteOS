---
name: Migration validation & readiness reporting
description: How content-fidelity validation must be scoped/calibrated and how the readiness report must count, to avoid phantom "held-back articles".
---

# Content-fidelity validation & migration-readiness counting

## The trap
A large `validationFailures` (e.g. ~1000) in `reports/migration-readiness.json` does NOT mean that many articles are broken or held back. It is usually a **reporting + over-strict-validator artifact**, not real content loss. Verify before "fixing extraction": check `SELECT status, page_type, count(*) FROM pages GROUP BY ...` — if everything is already `published` and `held-back-articles.json` total is 0, nothing is actually held back.

## Two root causes that recur
1. **Reports counted every historical `validation_reports` row**, not the latest-per-page, and didn't drop orphan rows for deleted pages. `validation_reports` is append-only (one row per (re)validation), so totals inflate. The report must dedupe to latest-per-page and `innerJoin` pages.
2. **The validator failed pages that were fine.** Two sub-cases:
   - Non-article pages (category/author/tag listings, web-story decks, blog `?s=` search, paginated index, and non-`/blog/` commerce pages misclassified as `post`) got content-fidelity volume checks they can never satisfy.
   - Real articles "failed" only on *partial* element under-counts: the source counter deep-counts widget/nav/FAQ/related-list elements in the raw DOM that the parser **correctly curates out**. A partial shortfall is expected curation, not breakage.

## The rule (decided design)
- Content-fidelity validation applies ONLY to genuine articles: `pageType==='post'` AND a real `/blog/` article URL (`isArticleUrl`/`isArticlePage` in `scripts/src/crawler/validate.ts`). Everything else → automatic pass.
- For articles, a partial element shortfall is a **warn** (informational, never held back). FAIL only on catastrophic loss: missing/`Untitled` title, empty component tree despite source prose, or near-empty tree (`components < 3 && source.paragraphs >= 10`).
- **Why:** raw-DOM counts systematically exceed curated output, so ratio-based fails produce false positives at scale; the held-back queue only exists to catch genuinely broken extraction.

## How to apply
- Validation logic is shared: `scoreValidation({source,parsed,title,pageType,url})` is the single source of truth, called by both `validateExtraction(page)` (live crawl) and the offline `scripts/src/revalidate.ts` (`pnpm --filter @workspace/scripts run revalidate`). Don't reimplement rules in either caller.
- Re-validation reuses the source/parsed tallies already stored on each page's latest `validation_reports.issues` (no HTML re-parse) — cheap and consistent. It appends a fresh row + re-syncs `pages.status`, then regenerates reports.
- After fixing validation, `ready:true` can still be blocked by a **separate** signal: `queueFailed` (permanently-failed crawl URLs). Those are mostly junk/malformed frontier URLs (smart-quote-concatenated links, asset `.jpg` paths) — a frontier-hygiene concern, NOT validation. Don't conflate the two.
- **Stale validation rows resurface as a phantom blocker.** `validationFailures` counts the *latest-per-page* `validation_reports` row. A revalidation run made with OLD validator logic (before non-article auto-pass / catastrophic-only fail) leaves stale `fail` rows — including category/author/page non-articles that current `scoreValidation` auto-passes — that block `ready:true` even though `held-back-articles.json` is 0 and every page is `published`. The current code is fine; the *rows* are stale. Fix = re-run `pnpm --filter @workspace/scripts run revalidate` (re-scores from stored tallies, no re-parse) to append fresh correct rows + regenerate reports. Don't go editing `validate.ts` — verify the latest rows aren't just stale first.
