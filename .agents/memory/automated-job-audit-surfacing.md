---
name: Automated job audit surfacing
description: How scheduled/standalone jobs surface their automated changes in the CMS audit log
---

# Surfacing automated (no-human-actor) changes in the CMS audit log

Scheduled/standalone scripts (e.g. `publish-scheduled`, `redirect-health`) make
DB changes with no Express request context, so they can't use `recordAudit`.
To make those changes visible to editors as a durable activity history:

1. **Producer** inserts an `audit_logs` row directly (best-effort, `.catch(()=>{})`)
   leaving `actorId`/`actorEmail`/`actorRole` null — the null actor is what marks
   it automated. Use a distinct dotted `action` (e.g. `article.publish.scheduled`,
   `redirect.deactivate.auto`), set `entityType`/`entityId`, put the human-readable
   identity (slug, fromPath/toPath) in `metadata`, and the state transition in
   `before`/`after`.
2. **CMS** (`artifacts/cms/src/pages/audit-log.tsx`) surfaces it: add the action to
   both `ACTION_OPTIONS` and `ACTION_LABELS` with a clear "Auto-…" label, add the
   `entityType` to `ENTITY_OPTIONS`. A null actor falls back to "Unknown actor".
   `DiffView` renders before→after; entity-specific entries (media, redirect) get a
   special-case renderer because the bare `entityId` (a UUID) isn't human-readable —
   pull the friendly identity from `metadata`.

**Why:** the only prior signal was a `crawl_logs` line invisible to editors; the
audit log is the durable, editor-facing history. `crawl_logs` is still written in
parallel because a scheduled deployment's filesystem is ephemeral and crawl_logs
survives in the prod DB.

**How to apply:** when adding any new automated/scheduled mutation that editors
should be able to review, write the audit_logs row in the job AND register its
label/entity in audit-log.tsx — otherwise it's invisible in the CMS.
