import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/src/**/*.test.ts"],
    environment: "node",
  },
});
