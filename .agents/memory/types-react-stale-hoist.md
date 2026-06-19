---
name: Stale @types/react hoist breaks web typecheck
description: When cms/web typecheck fails on button-group.tsx/calendar.tsx TS2322 but feature code is clean, the on-disk hoisted @types/react symlink is stale — fix with a forced reinstall, not override edits.
---

Symptom: `pnpm run typecheck` fails ONLY in a web artifact (e.g. `cms`) with TS2322 "Two different types with this name exist" in untouched shadcn files `components/ui/button-group.tsx` and `components/ui/calendar.tsx`, error text contrasting `@types+react@19.2.14` (expected) vs the hoisted version (actual). Feature code is unaffected.

Root cause: the virtual-store hoist symlink `node_modules/.pnpm/node_modules/@types/react` settled to the mobile-pinned 19.1.17 instead of the web-pinned 19.2.14. `react-day-picker` / loose `@radix-ui/react-slot` variants (which declare no `@types/react` peer) resolve React's types through that hoisted symlink, colliding with the web app's own direct 19.2.14.

**Why:** A bare `pnpm install` reports "Lockfile is up to date, resolution step is skipped" and does NOT re-derive the hoist symlink, so a stale 19.1.17 hoist persists even though the committed lockfile is unchanged. This can happen after any partial/interrupted install (e.g. installing to create a newly-added workspace symlink).

**How to apply:** Run `pnpm install --force` (rebuilds the virtual store and re-hoists to the majority version 19.2.14), then re-run `pnpm run typecheck`. Do NOT "fix" this by editing the `@types/react` overrides in `pnpm-workspace.yaml` — the dual global-19.2.x / scoped-mobile-19.1.x override setup is correct and the replit.md gotcha warns against changing it; the problem is only the on-disk hoist, not the override config.
