---
name: Crawler NUL/binary write-sink crash
description: A single binary response can kill the whole crawl via uncaught throws in text-write sinks; all sinks must be NUL-safe and error-logging must be non-fatal.
---

# Crawler NUL/binary write-sink crash

A crawl over the full corpus died when the frontier followed an asset URL
(`.../wp-content/uploads/.../*.jpg`): the fetcher decoded the binary body as
text, and inserting bytes containing `0x00` into a Postgres `text`/`json`
column throws error `22021` (`report_invalid_encoding`). The fatal part was the
*error path*: the worker's `catch` recorded the failure with an error string
that still held the binary bytes, so the failure-recording write threw `22021`
too — and that throw was **uncaught**, rejecting the worker promise and aborting
the entire `Promise.all`. Short/bounded runs never hit it; only the full crawl did.

**Why it matters:** one malformed page must never be able to abort the whole
run. Defense must cover *every* text-write sink, especially the ones on the
error path, or the very mechanism meant to record a failure becomes the thing
that crashes.

**How to apply:**
- Don't decode non-HTML bodies at all — gate on `content-type` and skip
  (treat missing/empty content-type as HTML; that's the safe crawler default).
- Keep asset URLs out of the frontier in the first place
  (`wp-content`/`wp-json`/`wp-includes` + binary extensions).
- `stripNul()` every user/remote-derived string before it reaches a DB text
  column — page store, queue `last_error`/reason, and crawl-log `url`/`message`.
- Make logging **best-effort**: wrap the crawl-log insert in try/catch so a log
  write can never reject a worker. Logging is the wrong place to be fatal.
- Stale-recovery (`in_progress`→`pending`) must respect the attempts ceiling:
  rows already at `attempts>=maxAttempts` must go to `failed`, not `pending`,
  or `claimBatch` (which requires `attempts<maxAttempts`) strands them
  un-reclaimable as stuck-pending.
