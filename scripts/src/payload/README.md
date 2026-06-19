# Payload CMS export / import

This directory turns the migrated content (the `pages` tree plus its related
authors, categories, tags, media, SEO and structured data) into **Payload CMS
collection documents** so editors can manage the content in Payload after the
migration — and round-trips editor changes back into the migration database.

- `mapping.ts` — pure, DB-free functions that map migration row shapes into
  Payload documents (including `componentTree` → Payload `layout` blocks) **and
  back** (`layoutToComponentTree`, `payloadAuthorToRow`, `payloadCategoryToRow`,
  `payloadTagToRow`, `payloadMetaToSeoRow`). Safe to unit-test and reuse without
  a database.
- `../export-payload.ts` — reads the database and writes a single export JSON.
- `import.ts` — the reverse of the export: reads the export JSON shape and
  upserts it back into the migration DB. CLI wrapper: `../import-payload.ts`.

## 1. Run the export

```bash
pnpm --filter @workspace/scripts run export:payload
# custom output path:
pnpm --filter @workspace/scripts run export:payload -- --out ./payload-export.json
```

Requires `DATABASE_URL` (or `SUPABASE_DATABASE_URL`) to be set — the same
connection the rest of the workspace uses.

Default output: `scripts/out/payload-export.json`.

## 2. Export shape

```jsonc
{
  "exportedAt": "2026-06-18T00:00:00.000Z",
  "schemaVersion": "1",
  "collections": {
    "media":      [ /* PayloadMediaDoc */ ],
    "authors":    [ /* PayloadAuthorDoc */ ],
    "categories": [ /* PayloadCategoryDoc */ ],
    "tags":       [ /* PayloadTagDoc */ ],
    "posts":      [ /* PayloadPostDoc */ ]
  }
}
```

Key conventions:

- **Stable ids.** Every document keeps its original migration UUID as `id`.
  Relationship fields (`author`, `categories`, `primaryCategory`, `tags`,
  `heroImage`, category `parent`) reference related documents **by that UUID
  string** — the shape a Payload relationship value expects. The loader below
  remaps these UUIDs to the ids Payload generates on create.
- **Posts carry every exported field.** Beyond the relationships and content,
  each `posts` doc includes `language`, the `url` group
  (`canonicalUrl` / `pathname` / `parentPath`), `readingTimeMinutes`,
  `wordCount` and `structuredData` (the JSON-LD array). Your `posts` collection
  needs matching fields (`primaryCategory` as a `relationship` to `categories`;
  `url` as a `group`; `structuredData` as an `array` of `{ type, data }`) so the
  loader carries all of them — see the runnable schema in
  `__tests__/payloadTestConfig.ts`.
- **Media is an upload collection.** Each `media` doc carries `sourceUrl` /
  `url` (the original CDN asset) plus `filename`, `mimeType`, `width`,
  `height`. Files are *not* downloaded by the export — the loader fetches and
  uploads each asset so Payload stores its own copy.
- **`posts.layout`** is a Payload `blocks` field assembled from each page's
  `componentTree`. Block types emitted: `heading`, `paragraph`, `list`,
  `section` (nested `content` blocks) and `html`. The lossless `content`
  (rich-text JSON) and `contentHtml` (cleaned HTML) are preserved alongside it
  so nothing is lost if your block set differs.
- **Order matters.** Load `media → authors → categories → tags → posts` so
  relationships resolve.

## 3. Load into a Payload instance

The export is intentionally adapter-agnostic JSON. Load it with Payload's
[Local API](https://payloadcms.com/docs/local-api/overview). Your Payload config
needs collections matching the fields above (`media` as an `upload` collection;
`authors`, `categories`, `tags`, `posts`; relationship fields as listed).

The loader is real, tested code: **`load.ts`** (`loadPayloadExport`). It performs
the media→authors→categories(+parents)→tags→posts load order, fetches and uploads
each media asset, remaps every original UUID to the id Payload generates on
create, and returns `{ idMap, counts, updated }`. It talks to a minimal structural
`PayloadLike` interface, so it runs against any Payload config that defines the
documented collections.

**Idempotent.** Every document is looked up by its natural key (filename for
media, slug for authors/categories/tags/posts) and updated in place when it
already exists, so re-running after a partial failure creates no duplicates.
`counts` reports documents newly created; `updated` reports pre-existing
documents updated in place. Run a one-off seed script inside your Payload
project:

```ts
// payload-import.ts (run inside your Payload project: `payload run payload-import.ts`)
import { getPayload } from "payload";
import config from "@payload-config";
import { readFile } from "node:fs/promises";
import { loadPayloadExport } from "./load"; // copy load.ts into your project, or import it

async function main() {
  const payload = await getPayload({ config });
  const data = JSON.parse(await readFile("payload-export.json", "utf8"));

  const { idMap, counts } = await loadPayloadExport(payload, data.collections);

  console.log("Imported into Payload:", counts);
  console.log("UUID → Payload id map size:", idMap.size);
  process.exit(0);
}

main();
```

`loadPayloadExport(payload, collections, opts?)` accepts an optional
`{ fetchImpl }` override for the media download (used by the integration test to
stub network access).

### One-command loader CLI

If your Payload project's config is reachable from this workspace, you can skip
the hand-written seed script above and run the bundled CLI instead. It reads the
export JSON, boots your Payload instance via its Local API config, and calls
`loadPayloadExport` for you:

```bash
# Point it at your Payload config (the module that default-exports buildConfig).
# Either pass --config or set PAYLOAD_CONFIG_PATH.
pnpm --filter @workspace/scripts run load:payload -- --config ./payload.config.ts

# custom export input path (default: scripts/out/payload-export.json):
pnpm --filter @workspace/scripts run load:payload -- \
  --config ./payload.config.ts --in ./payload-export.json

# or via env var:
PAYLOAD_CONFIG_PATH=./payload.config.ts \
  pnpm --filter @workspace/scripts run load:payload
```

Requirements:

- **A `payload` install resolvable from the run.** The CLI dynamically imports
  `payload` and your config, so they only need to exist where you invoke it. The
  simplest setup is to run the command from inside your Payload project (which
  already has `payload` and a config), or to have both on the module resolution
  path.
- **`--config <path>` or `PAYLOAD_CONFIG_PATH`** must point to your Payload
  config file. That file must default-export the result of `buildConfig({...})`,
  and its collections must match the documented shapes above (`media` as an
  `upload` collection; `authors`, `categories`, `tags`, `posts` with the listed
  relationship fields; `posts` needs `versions.drafts` enabled for `_status`).

The CLI prints the per-collection create counts and the size of the
old-UUID → new-Payload-id map on success, and exits non-zero on failure.

#### Preview a load with `--dry-run`

To see what a load *would* do against a populated Payload instance without
writing anything, pass `--dry-run`. The loader performs every natural-key
lookup but skips all create/update calls (and the media re-fetch + upload), then
prints the projected create-vs-update split per collection:

```bash
pnpm --filter @workspace/scripts run load:payload -- \
  --config ./payload.config.ts --dry-run
```

This is handy before a real load — especially after a partial failure — to
confirm how many documents would be created vs. updated. Programmatically,
`loadPayloadExport(payload, collections, { dryRun: true })` returns the same
`{ counts, updated }` breakdown while leaving the instance untouched.

### One-command migration (export + load)

For a fresh migration into Payload you don't need to run the export and load
steps separately. The bundled `migrate:payload` CLI runs the export, then feeds
the produced JSON straight into the loader against your Payload instance —
sharing a single intermediate file path so there's nothing to manage by hand:

```bash
# Reads the migration DB, writes scripts/out/payload-export.json, then loads it
# into the Payload instance at --config (or PAYLOAD_CONFIG_PATH).
pnpm --filter @workspace/scripts run migrate:payload -- --config ./payload.config.ts

# custom intermediate path (accepts --out or its --in alias):
pnpm --filter @workspace/scripts run migrate:payload -- \
  --config ./payload.config.ts --out ./payload-export.json

# or via env var:
PAYLOAD_CONFIG_PATH=./payload.config.ts \
  pnpm --filter @workspace/scripts run migrate:payload
```

It honors the same `--config` / `PAYLOAD_CONFIG_PATH` and `--out` / `--in`
conventions as `export:payload` and `load:payload`, and has the same
requirements as the loader (a resolvable `payload` install and a config whose
collections match the documented shapes). The intermediate JSON is still written
to disk, so you keep a copy of exactly what was loaded. Run the steps separately
(below) only when you need to inspect or edit the JSON before loading.

### Verified by an integration test

`__tests__/load.integration.test.ts` is the executable smoke test for this whole
flow. It boots a **real, ephemeral SQLite Payload instance**
(`__tests__/payloadTestConfig.ts` — the runnable version of "your Payload config
needs collections matching these fields"), loads a small fixture export through
`loadPayloadExport`, and asserts:

- every document is created and every export UUID is remapped (`idMap`/`counts`),
- media files are actually uploaded (Payload stores its own filename),
- the category `parent` relationship is remapped to the new Payload id,
- a loaded post resolves its `author`, `categories`, `tags` and `heroImage`,
  and the `componentTree` → `layout` block order survives the round-trip.

It runs in CI as part of `vitest run` (no external services — uses in-process
SQLite and a stubbed fetch). To run it on its own:

```bash
pnpm --filter @workspace/scripts exec vitest run src/payload/__tests__/load.integration.test.ts
```

Notes:

- `_status` requires `versions.drafts` enabled on the `posts` collection.
- If you prefer to keep the original UUIDs as Payload ids, configure a custom
  `id` field on each collection and pass `id` directly to `payload.create` —
  then the `idMap` remap step is unnecessary.
- `layout` blocks assume your `posts` collection defines a `blocks` field with
  `heading` / `paragraph` / `list` / `section` / `html` blocks. Adjust the block
  set to taste; `content`/`contentHtml` remain available as a fallback.

## 4. Round-trip edits back into the migration DB

Once editors change content in Payload, export those same collections back to the
JSON shape above (Payload's Local API `find` over each collection, wrapped in
`{ collections: { ... } }`) and feed it to the importer to upsert the migration
database:

```bash
pnpm --filter @workspace/scripts run import:payload
# custom input path:
pnpm --filter @workspace/scripts run import:payload -- --in ./payload-export.json
```

Default input: `scripts/out/payload-export.json`. Requires the same
`DATABASE_URL` the rest of the workspace uses.

What it does (the exact reverse of the export):

- **Idempotent.** Pages upsert on `canonicalUrl`; authors, categories and tags
  upsert on `slug`. Re-running with unchanged content is a no-op — no duplicate
  rows and no new version snapshot.
- **`layout` → `componentTree`.** Payload `blocks` are mapped back into the
  stored `componentTree` (importer object shape: `{ type: "root", children }`)
  and the flattened `blocks` table, via `layoutToComponentTree`.
- **Relationships resolved by natural key.** `author` / `categories` / `tags` /
  `heroImage` / category `parent` are resolved through the export's own
  collections (by `slug` / `url`), so the JSON may carry either the original
  migration UUIDs **or** Payload-generated ids — round-tripping works either way.
- **Version history.** A new `page_versions` snapshot is appended only when the
  editable content actually changed (sha256 content hash differs from the latest
  version).
- **Scope.** Only the children the export owns are rewritten: `componentTree`,
  `blocks`, `seo`, `breadcrumbs`, `faq`, `jsonld`, page↔category / page↔tag joins
  and the **featured** image (from `heroImage`). Inline images, internal/external
  links and raw `metadata` are **not** represented in the export and are left
  untouched.
