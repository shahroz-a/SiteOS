---
name: api-server spawning scripts-package CLIs
description: How the api-server runs @workspace/scripts CLIs as child processes (dev tsx vs prod bundle), and the tsx-location gotcha.
---

The api-server is a leaf package and must NOT import `@workspace/scripts`. To run
crawler/extraction work (e.g. re-extract a held-back article) it spawns the
scripts CLI as a child process and relays its NDJSON output.

Spawn selection (mirrors the redirect-health convention):
- **dev** (`NODE_ENV !== "production"`): run the TS source via `tsx`.
- **prod**: run the esbuild bundle `scripts/dist/<name>.mjs` with plain `node`
  (entry must be added to `ENTRY_POINTS` in `scripts/build.mjs`, and the
  api-server `build` script must also run `build:jobs` so the bundle exists).

**Gotcha — tsx is NOT at the repo root.** pnpm installs `tsx` into the *scripts*
package: `scripts/node_modules/.bin/tsx`. There is no `node_modules/.bin/tsx` at
the repo root, so a repo-root path fails with exit 127 / ENOENT.

**Why:** scripts declares `tsx` as its own devDependency; pnpm's strict layout
keeps it in that package's local bin, not hoisted to the root.

**How to apply:** when spawning a scripts CLI in dev, use
`path.join(REPO_ROOT, "scripts", "node_modules", ".bin", "tsx")`. Find REPO_ROOT
by walking up from `import.meta.url` until `pnpm-workspace.yaml`.

Streaming convention for live progress: the CLI writes one NDJSON
`{type:"progress",stage}` per stage on **stderr** and a single terminal
`{type:"result"|"error",...}` on **stdout**; the route streams these to the
client as `application/x-ndjson` (one JSON object per line). Such streaming
routes stay OUT of the OpenAPI/orval contract (like the sitemap/feed routes);
the web client reads them with `fetch` + a ReadableStream reader, not a hook.
