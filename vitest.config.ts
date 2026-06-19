import path from "node:path";
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Only the CMS app's tests import via the `@` alias; mirror its vite
      // config so vitest can resolve them here. The per-package vite configs
      // throw without PORT/BASE_PATH, so they can't be referenced directly.
      "@": path.resolve(import.meta.dirname, "artifacts/cms/src"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    include: [
      "lib/**/src/**/*.test.ts",
      "scripts/src/**/*.test.ts",
      "artifacts/api-server/src/**/*.test.ts",
      "artifacts/blog/src/**/*.test.ts",
      "artifacts/cms/src/**/*.test.{ts,tsx}",
      "artifacts/thanksgiving-mobile/hooks/**/*.test.{ts,tsx}",
    ],
    // The mobile package's `__tests__/` UI tests are jest-expo tests (they
    // render React Native components and use jest globals). Vitest's esbuild
    // transform can't parse the native module sources they pull in, so they
    // run only under jest. Vitest still runs the colocated `hooks/__tests__`
    // unit tests, which are written for vitest.
    exclude: [
      ...configDefaults.exclude,
      "artifacts/thanksgiving-mobile/__tests__/**",
    ],
    environment: "node",
  },
  esbuild: {
    jsx: "automatic",
  },
});
