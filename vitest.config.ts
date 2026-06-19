import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "lib/**/src/**/*.test.ts",
      "scripts/src/**/*.test.ts",
      "artifacts/api-server/src/**/*.test.ts",
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
