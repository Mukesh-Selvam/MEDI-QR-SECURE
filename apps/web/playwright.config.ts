import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = resolve(__dirname, "../..");
const rootEnvFile = resolve(repositoryRoot, ".env");
if (existsSync(rootEnvFile)) loadEnvFile(rootEnvFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const webServerEnvironment = {
  ...process.env,
  WEB_BASE_URL: baseURL,
  API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001",
  KEYCLOAK_BASE_URL:
    process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8080",
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? "mediqr",
  KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID ?? "mediqr-web",
};
const apiWebServerEnvironment = {
  ...webServerEnvironment,
  NODE_ENV: "test",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter @mediqr/api dev",
      cwd: repositoryRoot,
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: apiWebServerEnvironment,
    },
    {
      command: "pnpm --filter @mediqr/web dev",
      cwd: repositoryRoot,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: webServerEnvironment,
    },
  ],
});
