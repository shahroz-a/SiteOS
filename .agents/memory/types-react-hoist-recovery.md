---
name: "@types/react hoist see-saw recovery"
description: How to recover the pnpm @types/react hoist after an incremental install breaks web or mobile typecheck.
---

# @types/react hoist see-saw recovery

The workspace pins web → `@types/react@^19.2.x` (global override) and the mobile
subtree → `~19.1.x` (scoped override). pnpm hoists ONE bare `@types/react` into
`node_modules/.pnpm/node_modules/`; loose web deps (lucide-react, some radix,
react-day-picker) that declare no `@types/react` peer resolve react's types
through whatever that hoisted copy is.

**Symptom:** a plain incremental `pnpm install` (e.g. to link a newly-added
workspace dep) can flip the hoisted copy to `19.1.17`, which then makes a WEB
artifact fail typecheck (e.g. mockup-sandbox `spinner.tsx`: TS2322 "two different
types named ...Ref/Slot"). The correct hoist for full-green is `19.2.14`.

**Fix (fast path first):** a plain `pnpm install` (NO flags — not `--force`, not
`--frozen-lockfile`) recomputes the hoist against the existing lockfile and lands
`19.2.14` in ~7s ("Already up to date"), making full `pnpm run typecheck` green.
Try this FIRST. `rm -rf node_modules && pnpm install` also works but is far
slower; reserve it for when the fast path doesn't restore the hoist. Verify with
`cat node_modules/.pnpm/node_modules/@types/react/package.json | rg version`.

**Do NOT use `pnpm install --force` to fix the hoist.** `--force` rebuilds
node_modules from scratch and reliably runs LONGER than the bash tool's 120s cap,
so it gets killed mid-link — which itself re-corrupts the hoist to 19.1.17 (the
exact failure mode). Each killed `--force` makes it worse, not better. Plain
`pnpm install` is both faster and sufficient.

**Why:** an incremental install reuses `.modules.yaml` resolution state and can
keep a wrong hoist; a clean reinstall recomputes it.

**How to apply:**
- The `bash` tool caps at 120s and the fresh reinstall takes longer, so it
  "times out" (exit -1) WITHOUT failing — pnpm keeps running. Do NOT keep
  re-issuing it blindly. Instead inspect state: check the hoisted version,
  `node_modules/.modules.yaml` presence, and that key workspace deps are linked.
  Re-run install only if linking is genuinely incomplete.
- Never "fix" the see-saw by dropping either override (global 19.2.x or the
  mobile scoped 19.1.x) — that just regresses the other side. The fix is the
  hoist, not the overrides.
