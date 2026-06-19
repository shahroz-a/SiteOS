---
name: Expo dev-server reachability & verifying Expo code without a live preview
description: Why an Expo workflow can fail DIDNT_OPEN_A_PORT despite Metro being healthy, and how to verify Expo app code compiles without keeping a dev server alive.
---

# Expo dev-server reachability on Replit

Symptom: the Expo workflow (`expo start --localhost --port $PORT`) reaches a clean
steady state — Metro prints `Web is waiting on http://localhost:<PORT>` and
`Logs for your project will appear below` with no errors — yet `restart_workflow`
times out with `DIDNT_OPEN_A_PORT`, and Metro logs zero incoming probe requests.

**This can be structural/environmental, not a code or config bug.** Confirmed it
reproduces independently of all of these (none changed the outcome):
- `experiments.reactCompiler` true vs false
- cold vs fully warmed Metro transform cache (warmed via `expo export`)
- `--localhost` present vs removed (bind to loopback vs all interfaces)
- no stale processes; port free before restart

The artifact config matched the canonical scaffold exactly
(`.local/skills/artifacts/artifacts/expo/artifact.yaml`: `ensurePreviewReachable: /status`,
dev script in `files/package.json.template`). So a matching dev script + artifact.toml
is NOT the cause when this happens.

**Why:** the workflow's reachability probe goes through the Expo dev domain tunnel
(`$REPLIT_EXPO_DEV_DOMAIN`), not a plain localhost TCP check. When that tunnel→Metro
hop doesn't complete in-window, the workflow reports `DIDNT_OPEN_A_PORT` even though
Metro itself is up. This is below the application layer — app code cannot affect it.

**How to apply:** don't burn many cycles toggling reactCompiler / cache / bind flags;
they won't fix this. Verify the code statically instead (below), document the blocker,
and tell the user to try the preview pane / publish (the platform may route the preview
differently than the strict restart probe).

**Update — the probe is intermittent, not permanent.** A later session restarted the
same `thanksgiving-mobile` expo workflow with no config change and the probe passed;
the app then rendered live in the preview pane (browse list + category chips, article
detail with hero/gallery, search screen) against the running `/api` backend. So when
this blocks you, just retry `restart_workflow` (give it ~90s) and/or screenshot the
Expo dev domain directly via the `app_preview` screenshot — a transient failure clears
on its own. Start the `api-server` workflow first so the mobile data calls resolve.

# Verifying Expo code without a running dev server

The bash tool **kills any backgrounded/long-running process when the call returns**
(exit 143), and caps at 120s — so you cannot keep `expo start` alive outside a workflow
to curl/screenshot it. Instead:

- `pnpm exec expo export --platform web` (add `--dev` to use dev transforms) compiles
  the **entire module graph** and exits on its own. A clean `Exported: dist` proves the
  app has no bundling/runtime import errors. It also warms Metro's transform cache.
- It may exceed the 120s bash cap on a cold run (killed at 143), but the transform cache
  persists across runs, so a second/third pass completes. Delete the throwaway `dist/`
  after.
- Combined with `pnpm --filter @workspace/<slug> run typecheck`, a clean export is strong
  evidence the artifact is correct even when you can't get a live preview.
