---
name: componentTree discriminator key (type vs blockType)
description: Crawler componentTree nodes key the block discriminator as `type`; the importer/shared lib use `blockType`. Re-flattening a crawler tree with the shared helper crashes unless normalized.
---

# componentTree: `type` vs `blockType` discriminator

The stored `componentTree` differs across ingestion sources in TWO independent ways:

1. **Container shape** (already widely documented): the crawler stores a bare
   top-level **array** of blocks; the importer stores a single root **object**
   (`{ type:"root", children:[...] }`).
2. **Discriminator key**: the crawler's tree nodes key the block kind as
   **`type`** (its own `buildComponentTree`/`ComponentNode` in
   `scripts/src/crawler/normalize.ts`), while the importer and the shared
   `@workspace/content` `BlockNode`/`buildComponentTree`/`flattenBlocks` use
   **`blockType`**.

At crawl time the blocks table is fine because the crawler has its OWN local
flatten in `store.ts` that maps `node.type -> blockType`. The latent bug is that
the shared `componentTreeChildren` + `flattenBlocks` (used by the CMS write/import
path and the Payload export `layout`) read `blockType`, which is `undefined` on
crawler nodes.

**Why it matters:** re-flattening a crawler-ingested page through the shared
helper (e.g. a CMS export -> import round-trip — the whole live corpus is
crawler-ingested) produced `blocks` rows with a NULL `block_type` and crashed the
transactional import with Postgres `23502` (not-null violation). Silent variant:
the Payload export `layout` got `undefined` block kinds.

**Fix / how to apply:** `componentTreeChildren` normalizes every node recursively
to `BlockNode` shape, mapping `type` -> `blockType` when `blockType` is absent.
It only normalizes the structural tree (the `children` chain); `data` stays
opaque (it can hold richText with its own `type` keys). The stored componentTree
is left in its original shape — only the derived `blocks` flatten / Payload
layout consume the normalized view. Don't reintroduce a raw passthrough in
`componentTreeChildren`, and if you add a new componentTree producer, prefer the
shared `blockType` key.

**Verification:** `pnpm --filter @workspace/api-server run verify:cms-io`
(opt-in, `VERIFY_CMS_IO=1`) round-trips the live corpus export -> import -> restore
in rolled-back transactions and asserts no image/link/metadata loss. It caught
this bug originally.
