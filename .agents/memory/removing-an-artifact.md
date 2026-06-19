---
name: Removing an artifact (app) from the monorepo
description: How to fully remove an artifact/app — the workflow can't be removed directly; delete the dir and clean the cross-references.
---

# Removing an artifact (app) from the monorepo

To remove an artifact entirely (e.g. an Expo mobile app), **delete its directory**
(`rm -rf artifacts/<name>`). The platform auto-deregisters the artifact and removes
its artifact-managed workflow.

**Why:** `removeWorkflow` is a PROHIBITED_ACTION for artifact-managed workflows — you
cannot remove the workflow directly. Deleting the artifact directory is the only
supported removal path; the workflow disappears with it.

**How to apply — after deleting the dir, sweep these cross-references:**
- Root `package.json` `test` script (drop any `&& pnpm --filter @workspace/<name> run test`).
- Root `vitest.config.ts` (remove the package's `include`/`exclude` blocks).
- `pnpm-workspace.yaml` `overrides` scoped to the package (e.g. `@workspace/<name>>@types/*`)
  and any toolchain-only overrides it pulled in (e.g. all `@expo/ngrok-bin>*` for Expo).
- `replit.md` bullet(s) describing the app.
- Then run `pnpm install` (updates lockfile; Expo removal dropped ~726 pkgs) and
  `tsc --build --force` (rebuild composite lib dist).
- Final check: `rg` for the package name / framework keyword across the repo
  (ignore `pnpm-lock.yaml`, `.local/**`, generated `reports/*.json`).

**Decoupling caveat:** a shared lib the removed app consumed (e.g. `@workspace/content-diff`)
usually stays — other artifacts still import it. Verify consumers with `rg -l`
before assuming a lib is now dead.
