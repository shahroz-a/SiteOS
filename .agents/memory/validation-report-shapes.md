---
name: Validation report shapes & explorer join
description: validation_reports holds two incompatible issue shapes; the content-explorer join surfaces whichever is latest.
---

# Validation report shapes

`validation_reports` mixes report types under one table, and the issue list lives
under a DIFFERENT jsonb key per type:

- `content-fidelity` (importer fidelity diff) — issues at `issues.issues`, each
  `{ field, parsed, source, message, severity: "warn"|"fail" }`. In the imported
  corpus these are the ONLY rows that exist (thousands of them); there are zero
  `seo` rows until someone runs the publish gate.
- `seo` (the `@workspace/seo-validation` engine via `storeReport`) — checks at
  `issues.checks`, each a `SeoCheck` `{ id, label, severity: "error"|"warn"|"info",
  message, passed }`. Failed = `passed !== true`.

**Why it matters:** the content-explorer list query joins the latest report per
page via `DISTINCT ON ... ORDER BY created_at DESC` with NO `report_type` filter,
so the "Validation Score" column (and any issue drill-down) reflects whichever
type was written most recently — in practice `content-fidelity`. Any code that
reads a report's issues for the explorer must handle BOTH shapes and normalize
severity (`fail` → `error`). Reading only `issues.checks` silently yields empty
issues for the real corpus.

**How to apply:** when surfacing validation issues outside the SEO panel, branch
on `Array.isArray(issues.checks)` vs `Array.isArray(issues.issues)`.
