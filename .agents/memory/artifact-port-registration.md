---
name: Artifact dev-port registration
description: Why a newly-created artifact's dev workflow fails DIDNT_OPEN_A_PORT until the repl reboots, and what does NOT fix it.
---

# Artifact dev-port registration

An artifact created mid-session fails its dev workflow port probe (`DIDNT_OPEN_A_PORT`)
even though Vite/the dev server binds the port correctly. Logs show the server
"ready" on the port, but `getWorkflowStatus` reports `openPorts: null` for it.

**Root cause:** the workflow port probe can only see ports that have a `[[ports]]`
entry in `.replit`. Those entries are regenerated from each artifact's
`.replit-artifact/artifact.toml` **only at repl boot**. Artifacts that existed at
the last boot (their tomls were read) have entries and their workflows pass;
artifacts created after boot have no entry, so the probe never detects the port.

**Confirmed does NOT add a `[[ports]]` entry / does NOT fix it mid-session:**
- `createArtifact` — a pristine fresh scaffold fails identically.
- `verifyAndReplaceArtifactToml` — only edits the toml, not `.replit`.
- Direct `.replit` edits — blocked ("port mappings have their own tool").
- `configureWorkflow` — `PROHIBITED_ACTION` on artifact-managed workflow names;
  and even a brand-new non-artifact workflow with an explicit `waitForPort` on a
  supported port still fails the probe (no `[[ports]]` entry exists for it).
- A detached `nohup` dev server survives only briefly — the platform reaps
  processes not managed by a workflow, so you can't keep the preview alive that way.

**How to apply:** don't burn time trying to force the dev workflow green for a
mid-session artifact. Verify the app another way (typecheck, production `build`,
and `curl localhost:80<previewPath>` which returns 200 while a dev server runs).
Tell the user to reload the workspace (regenerates `.replit` from tomls) or publish
— production serve is a static build that doesn't use the dev probe.
