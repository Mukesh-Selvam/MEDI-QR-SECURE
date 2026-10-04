import { config as loadDotEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

process.env.NODE_ENV ??= "test";

const repositoryRoot = resolve(process.cwd(), "../..");
const envFile = resolve(repositoryRoot, ".env");

if (existsSync(envFile)) {
  loadDotEnv({ path: envFile, override: false });
}

const testDefaults: Record<string, string> = {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "5432",
  DB_NAME: "mediqr_test",
  DB_USER: "mediqr_test",
  DB_PASSWORD: "integration-postgres-password",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: "6379",
  STORAGE_ENDPOINT: "127.0.0.1",
  STORAGE_PORT: "9000",
  STORAGE_ACCESS_KEY: "integration-storage-user",
  STORAGE_SECRET_KEY: "integration-storage-password",
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "3310",
  KEYCLOAK_BASE_URL: "http://127.0.0.1:8080",
  KEYCLOAK_REALM: "mediqr",
  SESSION_SECRET: "integration-session-secret-at-least-32",
  AUDIT_HMAC_KEY: "integration-audit-key-at-least-32-characters",
  MASTER_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  KMS_MASTER_KEY: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  JWT_ACCESS_SECRET: "integration-access-secret-at-least-32",
  JWT_REFRESH_SECRET: "integration-refresh-secret-at-least-32",
  HMAC_QR_SIGNING_KEY: "integration-qr-signing-key-at-least-32",
  OTP_HMAC_SECRET: "integration-otp-hmac-key-at-least-32-characters",
  SMTP_HOST: "127.0.0.1",
  MAIL_FROM_ADDRESS: "integration@mediqr.invalid",
};

for (const [key, value] of Object.entries(testDefaults)) {
  process.env[key] ??= value;
}
