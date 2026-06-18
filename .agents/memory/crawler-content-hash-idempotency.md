---
name: Crawler content-hash idempotency
description: Why re-crawls can falsely show "changed" and how to prove the hash is actually deterministic.
---

The crawler decides whether to append a new `page_versions` row by comparing a sha256
content hash over `{title, cleanedHtml, componentTree}`. Re-storing a page that was
first stored by an *older code iteration* will legitimately report `changed: true` and
bump the version, because the normalization output differs between code versions — this
is NOT a non-determinism bug.

**Why:** During development, partially-crawled rows (including "stale in-progress"
items recovered on the next run) were written by earlier versions of extract/normalize.
A later run produces a slightly different (e.g. +N blocks) component tree, so the hash
differs once, creating a one-time version bump. After that, the row is current-code and
re-stores cleanly.

**How to apply:** To prove idempotency, do a *double-store with current code*: fetch →
assemble → store (baseline), then fetch → assemble → store again, and assert the second
store returns `changed: false` with zero new versions and zero block delta. Comparing
against pre-existing rows of unknown provenance will give false positives. Also: two
back-to-back `fetchPage`+`assemblePage` calls on the same URL produce byte-identical
cleanedHtml/componentTree/hash, so the extraction itself is deterministic.
