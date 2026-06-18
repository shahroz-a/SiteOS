---
name: Content-fidelity migrations
description: How to preserve 100% of source content when recreating an existing page/article as a new app.
---

# Content-fidelity migrations

When a task requires recreating an existing page with **exact** content preservation (no summarizing/paraphrasing/dropping):

- **Author the content yourself** as a typed source-of-truth data file (e.g. `src/data/content.ts`) before delegating UI work. Do not let the design subagent transcribe content — it will paraphrase, drop items, or "fix" intentional source quirks.
- **Tell the design subagent to render the data verbatim** and forbid inventing/altering/reordering content.

**Why:** A design subagent optimizes for polish and will silently "improve" source text. In one case it stripped emoji prefixes from headings via `.replace("🍲 ","")`, violating the preservation requirement. Centralizing content + a verbatim-render rule prevents this.

**How to apply:** Centralize every string/link/image/alt in the data file (preserve source quirks like wrong alt text and inline links). After the subagent finishes, run the `code_review` architect specifically asking it to check content-fidelity, responsiveness, and accessibility — it reliably catches content mutations and viewport `maximum-scale` anti-patterns.
