import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "lib/**/src/**/*.test.ts",
      "scripts/src/**/*.test.ts",
      "artifacts/api-server/src/**/*.test.ts",
      "artifacts/thanksgiving-mobile/**/*.test.{ts,tsx}",
    ],
    environment: "node",
  },
  esbuild: {
    jsx: "automatic",
  },
});
