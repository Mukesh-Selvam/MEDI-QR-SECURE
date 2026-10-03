import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.test.ts"],
    testTimeout: 15000, // real network I/O anti-stub tests need more time
    pool: "forks", // isolate env mutations between test files
  },
});
