---
name: zod root vs zod/v4 type identity
description: Why z.infer over generated api-zod schemas returns `unknown` unless you import z from the matching entry point
---

The repo pins `zod: 3.25.x`, which ships BOTH a v3-compatible root entry (`zod`) and an explicit `zod/v4` subpath. These are two different type systems with **incompatible type identities**.

- DB schemas / `drizzle-zod` code import `z` from `zod/v4`.
- Orval-generated API schemas (`lib/api-zod/src/generated/api.ts`) use `import * as zod from 'zod'` — the **root (v3)** entry.

**Rule:** when you `z.infer<typeof SomeGeneratedSchema>` over an api-zod schema, import `z` from `zod` (root), NOT `zod/v4`. Mixing them makes `z.infer` silently resolve to `unknown` — which then cascades into dozens of `TS18046 'x' is of type 'unknown'` and `TS2769 no overload matches` errors at every use site, with no hint that the import is the cause.

**Why:** the schema object carries the type brand of whichever zod entry created it; `z.infer` from the other entry can't read that brand.

**How to apply:** match the inference helper's entry point to the schema's. For api-zod-derived types in api-server libs, `import { z } from "zod"`. For drizzle/db-side schemas, keep `zod/v4`.

Related: when threading a Drizzle transaction through helpers typed `Executor = typeof db`, the repo convention is to cast at the `db.transaction` boundary (`const tx = txRaw as unknown as Executor`) — a bare `tx` is `PgTransaction` which lacks `$client` and is not assignable to `typeof db`.
