---
name: componentTree discriminator key (type vs blockType)
description: Crawler componentTree nodes key the block discriminator as `type`; the importer/shared lib use `blockType`. Re-flattening a crawler tree with the shared helper crashes unless normalized.
---

# componentTree: `type` vs `blockType` discriminator

**UPDATE — producers unified on `blockType`; the `?? type` fallback is now purely
defensive, do NOT remove it.** All producers (crawler `normalize.ts`/`store.ts`,
CMS editor `model.ts`) now emit `blockType`; renderer/toc/editor-load read
`blockType ?? type`. The DEV corpus was structurally migrated (see "Corpus
migration" below). The fallback stays because the PROD corpus keeps the old
`type` shape until a re-publish + re-run of the migration there.

The stored `componentTree` differs across ingestion sources in two ways. Only the
first remains live now:

1. **Container shape** (still live): the crawler stores a bare top-level **array**
   of blocks; the importer stores a single root **object**
   (`{ blockType:"root", children:[...] }`).
2. **Discriminator key** (historically): the crawler's tree nodes used to key the
   block kind as **`type`**, while the importer and shared `@workspace/content`
   use **`blockType`**. Producers are now all `blockType`; only *legacy stored
   data* (unmigrated prod, or a rolled-back dev DB) still carries `type`.

**Why the key matters (original bug):** re-flattening a crawler-ingested page
through the shared `componentTreeChildren` + `flattenBlocks` (CMS export->import,
Payload export `layout`) read `blockType`, `undefined` on old crawler nodes, so it
produced `blocks` rows with NULL `block_type` and crashed the transactional import
with Postgres `23502`. Silent variant: Payload `layout` got `undefined` kinds.

**Fix / how to apply:** `componentTreeChildren` still normalizes every node
recursively, mapping `type` -> `blockType` when `blockType` is absent — now a
defensive net for legacy/unmigrated data, NOT the primary path. It only normalizes
the structural tree (the `children` chain); `data` stays opaque (it holds richText
with its own legitimate `type` keys). Don't reintroduce a raw passthrough, don't
drop the `?? type` reads, and any new producer must emit `blockType`.

**Corpus migration (`scripts/src/migrate-component-tree-key.ts`):** one-off
structural rewrite — renames each block node's `type` -> `blockType`, recursing
**`children` only, NEVER `data`** (idempotent; `--dry-run` previews). Targets
three jsonb locations: `pages.component_tree`, `component_tree.tree`,
`page_versions.snapshot.componentTree`.
**Why:** prod stays `type` until republish, so the fallback can't be removed.
**How to apply:** run it batched (keyset by `id`, 200/batch) — it MUST page, not
read the whole table: `page_versions.snapshot` rows are FULL page snapshots and a
single un-paginated `SELECT *` exhausts memory/the pooler and the process dies
mid-table (this happened — pages/component_tree finished, page_versions stalled at
~2766/3584 with no error). Run the script via **direct `tsx`** in the foreground
or `setsid`; invoking it through `pnpm --filter … run` hung at startup with empty
stdout here. Verify completeness with the fast `executeSql` path, not by trusting
the script's stdout alone (e.g. `component_tree->0 ? 'type'` counts == 0).

**Verification:** `pnpm --filter @workspace/api-server run verify:cms-io`
(opt-in, `VERIFY_CMS_IO=1`) round-trips the live corpus export -> import -> restore
in rolled-back transactions and asserts no image/link/metadata loss. It caught
this bug originally.
