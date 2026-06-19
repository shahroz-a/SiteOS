---
name: Media audit-log display contract
description: How the CMS audit log renders media.metadata.update entries, and the shape a future PATCH producer must emit.
---

The CMS Audit Log screen renders `media.metadata.update` audit entries richly (thumbnail + before→after of alt/title/caption/altStatus). For this to display correctly, whoever writes those audit rows (the planned media PATCH route, `recordAudit`) must follow this contract:

- `action` = `"media.metadata.update"`.
- `entityType` = `"media"`, `entityId` = the image's **canonical CDN URL** (the stable media identifier). The display derives the thumbnail from `entityId` first, then falls back to `metadata.url` / `after.url` / `before.url`.
- `before` / `after` carry the edited fields: `alt`, `title`, `caption`, `altStatus`.

**Why:** the CDN URL is the media item's stable key everywhere else in the codebase (openapi `MediaItem.url`), so the audit display keys the thumbnail off it. If the producer omits a URL on all of entityId/metadata/after/before, the row renders a broken-image placeholder.

**How to apply:** when building the media metadata PATCH route in `artifacts/api-server/src/routes/cms-media.ts`, set those fields. The audit list endpoint (`GET /cms/audit-logs`) supports an `?action=` filter (server-side, pagination-correct), used by the "Image edits" toggle in `artifacts/cms/src/pages/audit-log.tsx`.

The PATCH producer now exists: `PATCH /cms/media/alt` calls `recordAudit` with this exact shape on success (entityId = CDN URL, before/after = {alt, altStatus}, metadata.url + updatedUsages). `updateAltByUrl` returns the before/after snapshot; altStatus is computed by the single source of truth `altStatusCaseSql` (no JS re-implementation). Only `alt`/`altStatus` are carried (an alt-text edit never touches title/caption).
