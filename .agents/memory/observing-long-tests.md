---
name: Observing long-running tests/validations
description: How to run and observe a >120s test/validation when the bash tool caps at 120s and vitest buffers output.
---

The bash tool hard-caps every command at ~120s and, on timeout, **kills the whole process group** — orphaned children do NOT reliably survive between bash calls (despite occasional appearances otherwise). `setsid`-detached jobs also get killed. So you cannot run *or* observe a test that needs >120s through bash.

Vitest's default reporter **buffers all output** when stdout is a file/pipe (no TTY): the log stays at the `RUN` header until the run completes, then the whole summary appears at once. Re-grepping a still-running vitest log shows nothing new — that is not a hang.

**Reliable path for a long test/validation:** register it as a workflow (validation workflows live in `.replit`) and run it with `restart_workflow`. The workflow process runs in the **platform's** space and persists independently of your bash session (it survived 7+ min across many tool calls here). Then poll with `refresh_all_logs` until `status` flips from `RUNNING` to `FINISHED`/`FAILED`, and read the final summary from the `/tmp/logs/<workflow>_<ts>.log` file it writes.

**Why:** repeatedly running the test foreground via bash just times out at 120s and kills it; you never see pass/fail. The workflow runner has its own (longer) timeout and is the canonical verification mechanism — `mark_task_complete` also triggers it.

**How to apply:** any DB-backed integration test / e2e / cold `tsc` that exceeds ~120s. Don't fight the bash cap; drive it through a workflow and observe via the log system. Keep gate-style validations bounded so they stay well under multi-minute (the CMS round-trip is capped to a 3-page sample via `CMS_IO_VERIFY_LIMIT`).
