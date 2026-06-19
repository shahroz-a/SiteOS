---
name: Missing workspace link + CMS UI import convention
description: Two unrelated TS2307 traps in this monorepo — an unlinked @workspace/* package, and the wrong UI import path in artifacts/cms.
---

## A newly-added lib may be unlinked → TS2307 cascade + phantom global errors

Symptom: `tsc --build` (typecheck:libs) reports `error TS2307: Cannot find module '@workspace/<x>'`
from a lib that imports it, plus *phantom* global errors in the same file like `TS2304/TS2552:
Cannot find name 'URL'`. The globals (`URL`, etc.) come transitively from the missing package's
`@types/node`, so they cascade from the same root cause — they are NOT a separate `types`/`lib` bug.

**Root cause:** the importing package declares the dep (`"@workspace/<x>": "workspace:*"`) but pnpm
never created the symlink — e.g. a lib was added to the workspace and `pnpm install` was not run, so
`<pkg>/node_modules/@workspace/<x>` (and the root `node_modules/@workspace/<x>`) is absent. Confirm by
listing `artifacts/<app>/node_modules/@workspace/` — a missing entry between its alphabetical
neighbours is the tell.

**Why:** `@workspace/db` etc. resolve via package.json `exports` pointing at **source** (`./src/index.ts`),
so dist/buildinfo state is a red herring; if resolution fails it's the symlink, not the emitted output.

**How to apply:** when `@workspace/*` shows TS2307, run `pnpm install` (idempotent; lockfile already up
to date just recreates links) BEFORE touching tsbuildinfo, dist, `tsc --build --force`, or `types`/`lib`
config. Do not chase it as a corrupted-declarations problem.

## CMS UI components import from `@workspace/ui/*`, never `@/components/ui/*`

In `artifacts/cms`, shadcn UI components live in the **`@workspace/ui`** package (`lib/ui/src/components/*.tsx`,
exported as `@workspace/ui/<name>`). There is NO `artifacts/cms/src/components/ui/` directory. Working
pages (audit-log.tsx, home.tsx) import `@workspace/ui/button`, `@workspace/ui/table`, etc. The `@/*` alias
(`@/* → ./src/*`) is only valid for things that actually exist under `src/` (e.g. `@/hooks/use-debounced-value`,
`@/components/app-shell`, `@/lib/...`).

**Pre-existing breakage (not yours):** several committed cms files import the non-existent `@/components/ui/*`
and therefore fail `tsc` at baseline — `src/pages/media.tsx`, `src/pages/import-export.tsx`,
`src/components/media-grid.tsx`, `src/components/media-picker.tsx`, `src/components/media-details-sheet.tsx`.
So a red `artifacts/cms` typecheck is partly baseline noise; isolate YOUR file's errors (e.g. `rg "<yourfile>"`)
before assuming you caused it.

## api-server typecheck is slow + how to run past the 120s bash cap

`pnpm --filter @workspace/api-server run typecheck` (`tsc -p tsconfig.json --noEmit`) re-typechecks all lib
**source** (exports → `.ts`), so a cold run exceeds the 120s bash timeout and writes no buildinfo (noEmit),
so retries can't resume. `setsid`/`nohup` детached processes are killed when the bash tool returns. Workaround
that works: run it as a temporary **console workflow** (`configureWorkflow` → `getWorkflowStatus`), which
survives beyond the cap; state `finished` = pass, `failed` = real errors (read `output`).
