---
name: Recovering stuck crawl_queue failures
description: How permanently-failed frontier rows accumulate as junk/transient, and why they can't self-heal without an explicit reset.
---

# Recovering stuck `crawl_queue` failed rows

## What they usually are
A full crawl's permanently-`failed` rows are almost never lost articles. Re-probe each with the crawler's bot UA before treating any as dead. The recurring buckets:
- **Genuine 404** — dead internal links discovered via frontier expansion. Cruft, skip.
- **Transient 403** — bot-throttling *under crawl load*, NOT permanent. The same URL returns 200/301/404 when re-probed later at low concurrency. Do not record these as dead from one loaded run.
- **Off-blog 301** — sitemap-declared pages that 301 to a non-`/blog/` product page (retired content). Skip (the pipeline's off-blog-redirect check already does this live).
- **On-blog 301 / malformed 200** — old/junk variants (`//` double-slash, mis-cased `/Melbourne-…/`, `/LINK`, `?p=`, concatenated segments) that resolve to a real canonical already crawled. Duplicates, not new pages.

## Why they get stuck (and the trap)
`claimBatch` only claims `status='pending' AND attempts < maxAttempts`. A row that exhausted `attempts=maxAttempts` (default 3) under OLD/stricter logic is stranded as `failed` forever — improving the skip rules does NOT retroactively reclaim it. You must explicitly reset it: `resetFailedToPending()` (CLI `--retry-failed`) sets status=pending, attempts=0, then a re-crawl re-classifies under current rules. (Same attempts-ceiling trap as `recoverStaleInProgress`.)

## Calibration decided
A frontier-discovered link returning ANY 4xx except 429 → skip (one attempt), not fail. 404/410 (gone), 403 (forbidden/throttled) are all dead-or-inaccessible source cruft. 429 (rate-limited) and 5xx stay retryable; sitemap-declared URLs still fail loudly. Malformed signals safe for this WordPress corpus: multi-slash paths and ANY uppercase letter in a path segment (0 completed canonicals have uppercase; catches mis-cased dups + the `/LINK` token).
