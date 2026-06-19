import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build as esbuild } from "esbuild";

// Plugins/loaders may use `require` to resolve dependencies.
globalThis.require = createRequire(import.meta.url);

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundle the scheduled jobs into standalone Node ESM files so production can run
 * them with `node` directly — no `tsx`/pnpm at runtime (mirrors the api-server
 * production convention for faster, dependency-light startup). Add more entry
 * points here as other scripts need a production build.
 */
const ENTRY_POINTS = ["src/redirect-health.ts", "src/rollup-page-views.ts"];

async function buildAll() {
  const distDir = path.resolve(scriptsDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: ENTRY_POINTS.map((e) => path.resolve(scriptsDir, e)),
    platform: "node",
    target: "node24",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Native / unbundleable packages — externalize so esbuild doesn't try to
    // inline them. pg-native is the one that actually matters for the DB client;
    // the rest are defensive in case a future entry point pulls them in.
    external: [
      "*.node",
      "pg-native",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "better-sqlite3",
      "sqlite3",
      "@payloadcms/*",
      "payload",
      "sharp",
      "canvas",
      "fsevents",
    ],
    sourcemap: "linked",
    // CJS-only deps (e.g. pg) bundled into ESM need require/__dirname shims.
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
