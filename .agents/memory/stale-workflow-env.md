---
name: Stale workflow-supervisor env vars
description: A removed secret can persist in a long-running workflow process and keep being inherited across restarts; design env precedence so a stale value can't hijack behavior.
---

# Stale env vars survive in the workflow supervisor

A secret/env var that was set earlier in a repl session and later deleted can
still linger in the long-running workflow supervisor's process environment.
`restart_workflow` starts the workflow command with the supervisor's inherited
env overlaid with the *current* secret store: current secrets win for keys that
still exist, but a key that exists ONLY in the inherited env (because it was
deleted from the store) passes straight through. So restarting the workflow does
NOT clear it. Confirmed by inspecting `/proc/<pid>/environ` after multiple
restarts: the deleted key was still present.

The agent has no tool to clear it. Only a **full workspace reload** (restart of
the container/supervisor) re-reads the secret store from scratch and drops the
stale key. Publishing also gets a fresh env (production).

**Why this matters:** implicit env precedence like
`process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL` will silently
prefer a stale leftover (e.g. an old DB URL pointing at a paused database),
hijacking the connection and producing confusing transient 500s even though the
current/correct value (`DATABASE_URL`) is right there.

**How to apply:**
- Don't let an *optional* override be chosen merely because it's present. Gate it
  behind an explicit opt-in flag (e.g. `USE_SUPABASE=true` AND a non-empty
  trimmed override) and default to the always-present managed var.
- When debugging "wrong target / paused service" errors, check whether the
  offending value is even a configured secret anymore (`viewEnvVars`). If it
  isn't, it's stale supervisor state — fix the code's selection logic or reload
  the workspace; don't keep restarting the workflow expecting it to clear.
- Inspect env provider by hostname suffix via `new URL(x).hostname` — never print
  secret values.
