import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["hooks/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  esbuild: {
    jsx: "automatic",
  },
});
