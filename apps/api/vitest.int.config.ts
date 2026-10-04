import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.int.spec.ts"],
    setupFiles: ["src/test/integration-setup.ts"],
    testTimeout: 30000,
    pool: "forks",
  },
});
