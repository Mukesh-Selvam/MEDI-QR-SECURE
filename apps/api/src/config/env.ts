/**
 * Environment Configuration & Validation
 * =======================================
 * All required environment variables are declared and validated here with Zod.
 * This module is the SINGLE source of truth for env config across the API.
 *
 * Rules (hard):
 *  - Fail fast at process start if any required variable is missing or wrong type.
 *  - Never print secret values in error messages (mask them).
 *  - This module must be imported BEFORE any other module that reads process.env.
 *
 * Loading strategy (CWD-independent):
 *  - We walk up from __dirname until we find the .env file at the monorepo root.
 *  - This works whether the API is started from apps/api, the repo root, or CI.
 *  - If NODE_ENV=production, we skip file loading entirely (secrets injected via
 *    the container's environment, not files).
 */

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Step 1: Load .env from the monorepo root (CWD-independent)
// ---------------------------------------------------------------------------
function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    // Monorepo root is identified by pnpm-workspace.yaml
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

if (process.env.NODE_ENV !== "production") {
  const startDir =
    typeof import.meta.url === "string"
      ? dirname(fileURLToPath(import.meta.url))
      : process.cwd();
  const root = findMonorepoRoot(startDir) || findMonorepoRoot(process.cwd());

  if (root) {
    const envPath = resolve(root, ".env");
    if (existsSync(envPath)) {
      const result = dotenvConfig({ path: envPath, override: false });
      if (result.error) {
        // Non-fatal: file exists but could not be parsed
        console.warn(`[Config] Warning: failed to parse ${envPath}:`, result.error.message);
      } else {
        console.log(`[Config] Loaded environment from ${envPath}`);
      }
    } else {
      console.warn(
        `[Config] No .env file found at ${envPath}. ` +
        `Copy .env.example to .env and fill in dev values.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: Secret masking helper — never print raw values in errors
// ---------------------------------------------------------------------------
const SECRET_KEYS = new Set([
  "DB_PASSWORD",
  "REDIS_PASSWORD",
  "STORAGE_SECRET_KEY",
  "KEYCLOAK_CLIENT_SECRET",
  "KEYCLOAK_ADMIN_PASSWORD",
  "KEYCLOAK_API_CLIENT_SECRET",
  "MASTER_ENCRYPTION_KEY",
  "KMS_MASTER_KEY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "HMAC_QR_SIGNING_KEY",
  "SESSION_SECRET",
  "AUDIT_HMAC_KEY",
  "OTP_HMAC_SECRET",
  "SMTP_PASSWORD",
  "DATABASE_URL",
  "REDIS_URL",
]);

function formatEnvErrors(issues: z.ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const key = issue.path.join(".");
    const isSecret = SECRET_KEYS.has(key);
    const hint = isSecret ? " (value hidden — do not log secrets)" : "";
    return `  ✗ ${key}: ${issue.message}${hint}`;
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step 3: Zod schema for every environment variable the API consumes
// ---------------------------------------------------------------------------
const EnvSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug", "verbose"]).default("info"),

  // Server
  PORT_API: z.coerce.number().int().min(1024).max(65535).default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  // PostgreSQL
  DB_HOST: z.string().min(1, "DB_HOST must be set"),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1, "DB_NAME must be set"),
  DB_USER: z.string().min(1, "DB_USER must be set"),
  DB_PASSWORD: z.string().min(1, "DB_PASSWORD must be set (never empty in any env)"),
  DB_SSL_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),

  // Redis
  REDIS_HOST: z.string().min(1, "REDIS_HOST must be set"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().url().optional(), // Convenience URL for BullMQ — derived from REDIS_HOST/PORT/PASSWORD if not set

  // MinIO / Object Storage
  STORAGE_ENDPOINT: z.string().min(1, "STORAGE_ENDPOINT must be set"),
  STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_USE_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  STORAGE_ACCESS_KEY: z.string().min(1, "STORAGE_ACCESS_KEY must be set"),
  STORAGE_SECRET_KEY: z.string().min(1, "STORAGE_SECRET_KEY must be set"),
  STORAGE_BUCKET_DOCUMENTS: z.string().min(1).default("mediqr-documents"),
  STORAGE_BUCKET_QUARANTINE: z.string().min(1).default("mediqr-quarantine"),
  STORAGE_REGION: z.string().default("ap-south-1"),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10485760), // 10 MB

  // ClamAV
  CLAMAV_HOST: z.string().min(1, "CLAMAV_HOST must be set"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  // Keycloak OIDC
  KEYCLOAK_BASE_URL: z.string().url("KEYCLOAK_BASE_URL must be a valid URL"),
  /** Alias used in guards/services */
  KEYCLOAK_URL: z.string().url().optional(),
  KEYCLOAK_REALM: z.string().min(1, "KEYCLOAK_REALM must be set"),
  KEYCLOAK_CLIENT_ID: z.string().min(1, "KEYCLOAK_CLIENT_ID must be set"),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1, "KEYCLOAK_CLIENT_SECRET must be set"),
  /** The confidential API service-account client */
  KEYCLOAK_API_CLIENT_ID: z.string().default("mediqr-api"),
  KEYCLOAK_API_CLIENT_SECRET: z.string().min(1, "KEYCLOAK_API_CLIENT_SECRET must be set"),

  // Cerbos PDP
  CERBOS_HOST: z.string().min(1).default("localhost"),
  CERBOS_PORT: z.coerce.number().int().positive().default(3593),

  // Session & CSRF
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)"),
  AUDIT_HMAC_KEY: z
    .string()
    .min(32, "AUDIT_HMAC_KEY must be at least 32 characters (generate with: openssl rand -hex 32)"),

  // Cryptography
  MASTER_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "MASTER_ENCRYPTION_KEY must be a 64-character hex string (256-bit key)"
    ),
  /** KMS master key for envelope-encrypting per-document DEKs */
  KMS_MASTER_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "KMS_MASTER_KEY must be a 64-character hex string (256-bit key). Generate: openssl rand -hex 32"
    ),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  HMAC_QR_SIGNING_KEY: z.string().min(32, "HMAC_QR_SIGNING_KEY must be at least 32 characters"),
  OTP_HMAC_SECRET: z.string().min(32, "OTP_HMAC_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)"),

  // Mailer
  SMTP_HOST: z.string().min(1, "SMTP_HOST must be set"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  MAIL_FROM_ADDRESS: z.string().email("MAIL_FROM_ADDRESS must be a valid email"),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default("http://localhost:4318"),
  OTEL_SERVICE_NAME: z.string().default("mediqr-platform"),
});

export type Env = z.infer<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// Step 4: Parse and export — fail fast on any error, never swallow
// ---------------------------------------------------------------------------
function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = formatEnvErrors(result.error.issues);
    const message =
      `\n` +
      `╔═══════════════════════════════════════════════════════════════╗\n` +
      `║           FATAL: Invalid environment configuration           ║\n` +
      `╚═══════════════════════════════════════════════════════════════╝\n` +
      `The following required environment variables are missing or invalid:\n\n` +
      `${errors}\n\n` +
      `Fix: copy .env.example to .env at the monorepo root and fill in values.\n` +
      `     Never commit secret values. Use a secrets manager in production.\n`;

    console.error(message);
    process.exit(1);
  }

  // Derive KEYCLOAK_URL from KEYCLOAK_BASE_URL if not explicitly set
  if (!result.data.KEYCLOAK_URL) {
    result.data.KEYCLOAK_URL = result.data.KEYCLOAK_BASE_URL;
  }

  return result.data;
}

/** Validated, typed environment. Import this instead of reading process.env directly. */
export const env = validateEnv();

