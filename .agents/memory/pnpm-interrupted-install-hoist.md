---
name: Interrupted pnpm install corrupts @types/react hoist
description: A killed/timed-out pnpm install can leave the wrong @types/react hoisted, surfacing the documented button-group/calendar TS2322 dual-types failure; --force repairs it.
---

# Interrupted pnpm install corrupts the @types/react hoist

If a `pnpm install` is killed mid-run (e.g. the bash 120s cap or a manual
timeout), node_modules can be left in a half-written state where the WRONG
`@types/react` is hoisted into `node_modules/.pnpm/node_modules/@types/react`
(lands on **19.1.17**, the mobile-scoped version, instead of **19.2.14**).

**Symptom:** `pnpm --filter @workspace/cms run typecheck` (and the full
`pnpm run typecheck`) fail ONLY in untouched shadcn scaffold files
`components/ui/button-group.tsx` and `components/ui/calendar.tsx` with TS2322
"Two different types with this name exist" / `VoidOrUndefinedOnly` /
`SlotProps.onChange` errors — the dual-`@types/react` gotcha already documented
in `replit.md`. Your own edited files show zero errors.

**Why it's a trap:** `pnpm install --frozen-lockfile` reports "Already up to
date" and does NOT repair it — it only checks lockfile↔store mapping, not deep
hoist/symlink integrity. So a frozen reinstall leaves 19.1.17 hoisted and the
typecheck stays red.

**Fix:** `pnpm install --force` rebuilds node_modules from the store and
restores the correct **19.2.14** hoist; typecheck goes green. Confirm with:
`cat node_modules/.pnpm/node_modules/@types/react/package.json | rg version`.

**How to apply:** When cms/web typecheck fails ONLY in button-group/calendar
and you recently had an install interrupted, don't chase the shadcn component
code or the override config — check the hoisted `@types/react` version first,
and run `pnpm install --force` if it's 19.1.x.
