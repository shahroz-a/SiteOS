---
name: Composite lib using import.meta.env
description: Why a browser lib that uses import.meta.env needs a self-contained vite-env.d.ts once it becomes composite.
---

A `lib/*` package that is consumed directly by a Vite artifact can use `import.meta.env`
without declaring any types — it inherits the artifact's `vite/client` types at the
consumer. But to be added to the root `tsconfig.json` `references` (required for a leaf
artifact to reference it via project references), the lib must be `composite`, which makes
`tsc --build` compile it **standalone**. Standalone, it has no `vite/client` types, so
`import.meta.env` throws `TS2339: Property 'env' does not exist on type 'ImportMeta'`.

**Why:** composite forces independent compilation; the lib no longer borrows the consumer's
ambient types.

**How to apply:** add a self-contained `src/vite-env.d.ts` in the lib declaring just the
`ImportMetaEnv` keys it uses (e.g. `BASE_URL`) plus the `ImportMeta.env` member. Do NOT add
a `vite/client` dependency to the lib — the minimal ambient declaration is enough and keeps
the lib framework-light. (Hit when `@workspace/replit-auth-web` was made composite to be
referenced by the `cms` artifact.)
