---
name: Object storage image upload (CMS editor)
description: How direct image upload to object storage is wired for the CMS block editor, and the serving-URL path convention.
---

# Direct image upload (CMS Image/Gallery blocks)

Flow: client POSTs JSON metadata to `POST /api/storage/uploads/request-url` (gated
on `content.create`|`content.edit`), gets back `{ uploadURL, objectPath }`, then
PUTs the raw file bytes straight to the presigned `uploadURL` (GCS). No file bytes
ever pass through the API server.

**Serving-URL convention:** `normalizeObjectEntityPath()` returns `/objects/<id>`.
The public serving route is `GET /storage/objects/*path` (mounted at `/api`), so the
stored block `src` is `"/api/storage" + objectPath` = `/api/storage/objects/<id>`.
This root-relative URL renders on BOTH the CMS (`/cms/`) and the public blog
(`/blog/`) because everything routes through the shared proxy at `:80`.

**Why a hand-rolled `<input type=file>` flow (not Uppy / object-storage-web):**
the Uppy-based helper drags React 19 / `@types/react` peer-variant conflicts into
the web artifacts. A tiny fetch-based uploader (`artifacts/cms/src/lib/use-image-upload.ts`)
sidesteps that entirely.

**Template gotcha:** the copied `objectStorage.ts` has a strict-TS gap —
`await response.json()` is `unknown`, so the `signed_url` destructure needs an
explicit cast or `tsc` fails (TS2339). Serving GET is intentionally unauthenticated
(public blog images).
