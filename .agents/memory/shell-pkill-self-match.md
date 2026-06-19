---
name: pkill self-match in the bash tool
description: Why pkill -f sometimes kills the agent's own bash shell (exit 143, no output) and how to avoid it.
---

# pkill -f self-matches the bash tool's own shell

In the bash tool, the whole command string is the shell process's argv. `pkill -f <pattern>` matches against full command lines, so a pattern that appears literally in your command (e.g. `pkill -f crawl-compare`, `pkill -f "playwright install"`) **also matches the running shell itself** and SIGTERMs it. Symptom: the command exits with code **143 and produces no output at all** (the shell dies before even the first `echo`).

**How to apply:** use the bracket trick so the pattern can't match its own argv: `pkill -f '[c]rawl-compare'`. The regex `[c]rawl-compare` matches the target process's `crawl-compare`, but the literal `[c]rawl-compare` in the pkill command line does not match the regex. Also avoid running `pkill` in the same command as other work you need to complete.
