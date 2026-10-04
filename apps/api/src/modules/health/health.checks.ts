/**
 * MediQR Health Check Probes
 * ==========================
 * Every function in this file MUST perform a real network call.
 * Returning a hard-coded "ok" without making the call is a hard violation.
 *
 * Each probe:
 *  - Reads config from the validated `env` object (never raw process.env)
 *  - Races real I/O against a 2-second AbortSignal / timer
 *  - Returns {status:"error", detail:"<human-readable message>"} on failure
 *  - Returns {status:"ok", latencyMs:<n>} on success
 */

import net from "net";
import { Client as PgClient } from "pg";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import {
  CheckResult,
  ReadinessResult,
  HEALTH_CHECK_TIMEOUT_MS,
} from "./health.types.js";

// ---------------------------------------------------------------------------
// Generic timeout helper
// ---------------------------------------------------------------------------
async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Robust error message extractor (handles AggregateError & missing message)
// ---------------------------------------------------------------------------
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string; cause?: unknown; errors?: unknown[] };
    const code = anyErr.code;
    const msg = anyErr.message?.trim();
    if (code && msg) return `${code}: ${msg}`;
    if (code) return code;
    if (msg) return msg;

    if (Array.isArray(anyErr.errors) && anyErr.errors.length > 0) {
      const parts = anyErr.errors
        .map((e) =>
          e instanceof Error
            ? (e as { code?: string }).code || e.message
            : String(e)
        )
        .filter(Boolean);
      if (parts.length > 0) return parts.join("; ");
    }

    if (anyErr.cause) {
      return extractErrorMessage(anyErr.cause, fallback);
    }

    return err.name || fallback;
  }
  return String(err) || fallback;
}

// ---------------------------------------------------------------------------
// 1. PostgreSQL — SELECT 1 with 2-second timeout
// ---------------------------------------------------------------------------
export async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  const client = new PgClient({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD, // always a non-empty string — validated by Zod
    connectionTimeoutMillis: HEALTH_CHECK_TIMEOUT_MS,
    statement_timeout: HEALTH_CHECK_TIMEOUT_MS,
    query_timeout: HEALTH_CHECK_TIMEOUT_MS,
    ssl: env.DB_SSL_ENABLED ? { rejectUnauthorized: true } : false,
  });

  try {
    await withTimeout(async (signal) => {
      const connectPromise = client.connect();
      signal.addEventListener("abort", () => void client.end(), { once: true });
      await connectPromise;
      await client.query("SELECT 1");
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = extractErrorMessage(
      err,
      `Database connection failed on ${env.DB_HOST}:${env.DB_PORT}`
    );
    return { status: "error", latencyMs: Date.now() - start, detail: message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// 2. Redis — PING/PONG with 2-second timeout
// ---------------------------------------------------------------------------
export async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    connectTimeout: HEALTH_CHECK_TIMEOUT_MS,
    commandTimeout: HEALTH_CHECK_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // fail fast, no retries
  });

  try {
    await withTimeout(async (signal) => {
      const connectPromise = client.connect();
      signal.addEventListener("abort", () => client.disconnect(), {
        once: true,
      });
      await connectPromise;
      const pong = await client.ping();
      if (pong !== "PONG") {
        throw new Error(`Unexpected Redis response: ${pong}`);
      }
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = extractErrorMessage(
      err,
      `Redis connection failed on ${env.REDIS_HOST}:${env.REDIS_PORT}`
    );
    return { status: "error", latencyMs: Date.now() - start, detail: message };
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

// ---------------------------------------------------------------------------
// 3. MinIO / S3 — GET /minio/health/live with 2-second timeout
// ---------------------------------------------------------------------------
export async function checkStorage(): Promise<CheckResult> {
  const start = Date.now();
  const scheme = env.STORAGE_USE_SSL ? "https" : "http";
  const healthUrl = `${scheme}://${env.STORAGE_ENDPOINT}:${env.STORAGE_PORT}/minio/health/live`;

  try {
    const { default: fetch } = await import("node-fetch");

    await withTimeout(async (signal) => {
      let res: Awaited<ReturnType<typeof fetch>>;
      try {
        res = await fetch(healthUrl, {
          method: "GET",
          signal: signal as unknown as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
        });
      } catch (fetchErr: unknown) {
        // node-fetch wraps the OS error — extract the root cause code if present
        let msg: string;
        if (fetchErr instanceof Error) {
          const cause = (fetchErr as Error & { cause?: unknown }).cause;
          const causeDetail = cause ? extractErrorMessage(cause, "") : "";
          const base = fetchErr.message.replace(/,\s*reason:\s*$/, "").trim();
          msg = causeDetail ? `${base} (${causeDetail})` : base;
        } else {
          msg = String(fetchErr);
        }
        throw new Error(`MinIO unreachable at ${healthUrl} — ${msg}`);
      }

      // MinIO /minio/health/live returns 200 when healthy
      if (!res.ok) {
        throw new Error(
          `MinIO health endpoint ${healthUrl} returned HTTP ${res.status} ${res.statusText}`
        );
      }
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = extractErrorMessage(
      err,
      `MinIO connection failed on ${healthUrl}`
    );
    return { status: "error", latencyMs: Date.now() - start, detail: message };
  }
}

// ---------------------------------------------------------------------------
// 4. ClamAV — zPING/PONG over TCP socket with 2-second timeout
//
// Fix: the previous implementation could resolve with detail="" when the socket
// closed before either the PONG check or the error handler ran. Now we use a
// single promise that tracks the definitive resolution reason.
// ---------------------------------------------------------------------------
export async function checkScanner(): Promise<CheckResult> {
  const start = Date.now();

  return new Promise<CheckResult>((resolve) => {
    let settled = false;
    let responseData = "";

    function done(result: CheckResult) {
      if (!settled) {
        settled = true;
        socket.destroy();
        clearTimeout(timer);
        resolve(result);
      }
    }

    const timer = setTimeout(() => {
      done({
        status: "error",
        latencyMs: Date.now() - start,
        detail: `ClamAV did not respond within ${HEALTH_CHECK_TIMEOUT_MS}ms — host: ${env.CLAMAV_HOST}:${env.CLAMAV_PORT}`,
      });
    }, HEALTH_CHECK_TIMEOUT_MS);

    const socket = new net.Socket();

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      // ClamAV protocol: null-terminated PING command
      socket.write("zPING\0");
    });

    socket.on("data", (data) => {
      responseData += data.toString();
      if (responseData.includes("PONG")) {
        done({ status: "ok", latencyMs: Date.now() - start });
      }
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      const detail = [err.code, err.message].filter(Boolean).join(": ") ||
        `connection failed to ${env.CLAMAV_HOST}:${env.CLAMAV_PORT}`;
      done({
        status: "error",
        latencyMs: Date.now() - start,
        detail: `ClamAV TCP error on ${env.CLAMAV_HOST}:${env.CLAMAV_PORT} — ${detail}`,
      });
    });

    socket.on("close", (hadError) => {
      if (!settled) {
        // Socket closed without PONG and without a preceding error event
        const reason = hadError
          ? "connection closed with error (no error event fired)"
          : `connection closed by ClamAV without PONG — partial response: "${responseData.trim() || "<empty>"}"`;
        done({
          status: "error",
          latencyMs: Date.now() - start,
          detail: `ClamAV ${env.CLAMAV_HOST}:${env.CLAMAV_PORT} — ${reason}`,
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregate: run all 4 checks in parallel, return ReadinessResult
// ---------------------------------------------------------------------------
export async function runAllChecks(): Promise<ReadinessResult> {
  const start = Date.now();

  const [database, redis, storage, scanner] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkStorage(),
    checkScanner(),
  ]);

  const checks = { database, redis, storage, scanner };
  const failing = (Object.entries(checks) as [string, CheckResult][])
    .filter(([, r]) => r.status !== "ok")
    .map(([name]) => name);

  return {
    status: failing.length === 0 ? "ready" : "degraded",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
    checks,
    ...(failing.length > 0 ? { failing } : {}),
  };
}
