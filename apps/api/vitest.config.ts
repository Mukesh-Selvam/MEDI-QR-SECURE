import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.test.ts"],
    exclude: ["src/**/*.int.spec.ts"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15000,
    pool: "forks", // isolate env mutations between test files
  },
});
