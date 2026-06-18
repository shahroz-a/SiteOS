---
name: componentTree shape divergence (crawler vs importer)
description: The two ingestion paths store pages.componentTree in different JSON shapes; the read API contract must accept both.
---

The crawler path (`scripts/src/crawler/assemble.ts` → `buildComponentTree($, contentRoot)`)
stores `pages.component_tree` as a **top-level JSON array** of block nodes
(`[{type:"section",...}, ...]`). The importer path
(`scripts/src/import/parse.ts` → `buildComponentTree(blocks)`) stores it as a
**single root object** (`{type:"root", children:[...], schemaVersion}`).
`pages.rich_text` is consistently an object on both paths.

**Why:** componentTree is opaque, Payload-compatible passthrough JSON for the
renderer. Because two independent ingestion engines produce it, its top-level
shape is not stable. An OpenAPI schema that pins it to `type: object` makes the
`GET /posts/{slug}` zod response validation 500 on every array-shaped (crawler)
page.

**How to apply:** Keep the `componentTree` field in `lib/api-spec/openapi.yaml`
as a `oneOf` of object / array / null (generates a zod union) — never narrow it
back to object-only. If you add a third ingestion path, treat componentTree as
arbitrary JSON, not a fixed shape.

**Renderer note:** Crawler-produced componentTree `section` blocks can omit
their `children` array (and `list` blocks their `items`) — the field is optional
in the data even though the TS type declares it required. Any renderer walking
these nodes must guard (`node.children ?? []`, `items ?? []`) or it throws
"Cannot read properties of undefined (reading 'map')" and the whole article page
white-screens behind a runtime overlay.

**Testing note:** `GET /posts/{slug}` fires ~8 sequential DB queries per
request. Hammering it at high concurrency (e.g. `xargs -P 12`) against the
Supabase session pooler — especially while the crawler runs — exhausts the pool
and yields transient 500s that look like validation failures but are not.
Verify functional correctness at low concurrency (`-P 3`).
