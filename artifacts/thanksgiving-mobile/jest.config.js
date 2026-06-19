module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  roots: ["<rootDir>/__tests__"],
  // Only the package-root `__tests__/` holds jest-expo UI tests. Colocated
  // unit tests (e.g. `hooks/__tests__/`) are vitest tests and must not be run
  // here — jest's babel can't parse their top-level `await import`.
  testMatch: [
    "<rootDir>/__tests__/**/*.test.tsx",
    "<rootDir>/__tests__/**/*.test.ts",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(\\.pnpm/)?((jest-)?react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|react-native-safe-area-context|react-native-reanimated|react-native-worklets|@react-native-async-storage))",
  ],
};
