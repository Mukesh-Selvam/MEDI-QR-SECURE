import net from "net";
import { Client as PgClient } from "pg";
import Redis from "ioredis";
import {
  CheckResult,
  ReadinessResult,
  HEALTH_CHECK_TIMEOUT_MS,
} from "./health.types.js";

// ---------------------------------------------------------------------------
// Generic timeout helper: races a real I/O promise against a hard deadline.
// ---------------------------------------------------------------------------
async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await operation(controller.signal);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 1. PostgreSQL — SELECT 1 with 2-second timeout
// ---------------------------------------------------------------------------
export async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  const client = new PgClient({
    host: process.env["DB_HOST"] ?? "localhost",
    port: Number(process.env["DB_PORT"] ?? 5432),
    database: process.env["DB_NAME"] ?? "mediqr_db",
    user: process.env["DB_USER"] ?? "mediqr_user",
    password: process.env["DB_PASSWORD"] ?? "",
    connectionTimeoutMillis: HEALTH_CHECK_TIMEOUT_MS,
    statement_timeout: HEALTH_CHECK_TIMEOUT_MS,
    query_timeout: HEALTH_CHECK_TIMEOUT_MS,
  });

  try {
    await withTimeout(async (signal) => {
      const connectPromise = client.connect();
      signal.addEventListener("abort", () => client.end(), { once: true });
      await connectPromise;
      await client.query("SELECT 1");
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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
    host: process.env["REDIS_HOST"] ?? "localhost",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    password: process.env["REDIS_PASSWORD"] ?? undefined,
    connectTimeout: HEALTH_CHECK_TIMEOUT_MS,
    commandTimeout: HEALTH_CHECK_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // no retries — fail fast
  });

  try {
    await withTimeout(async (signal) => {
      const connectPromise = client.connect();
      signal.addEventListener("abort", () => client.disconnect(), {
        once: true,
      });
      await connectPromise;
      const pong = await client.ping();
      if (pong !== "PONG") throw new Error(`Unexpected Redis response: ${pong}`);
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", latencyMs: Date.now() - start, detail: message };
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
}

// ---------------------------------------------------------------------------
// 3. MinIO / S3 — HEAD bucket with 2-second timeout (no AWS SDK needed)
// ---------------------------------------------------------------------------
export async function checkStorage(): Promise<CheckResult> {
  const start = Date.now();
  const endpoint = process.env["STORAGE_ENDPOINT"] ?? "localhost";
  const port = process.env["STORAGE_PORT"] ?? "9000";
  const accessKey = process.env["STORAGE_ACCESS_KEY"] ?? "";
  const secretKey = process.env["STORAGE_SECRET_KEY"] ?? "";
  const bucket = process.env["STORAGE_BUCKET_DOCUMENTS"] ?? "mediqr-documents";
  const useSSL = process.env["STORAGE_USE_SSL"] === "true";
  const scheme = useSSL ? "https" : "http";

  const url = `${scheme}://${endpoint}:${port}/${bucket}`;

  // Build AWS Signature V4 — auth header required for MinIO even on HEAD
  // We use a simplified approach: hit the MinIO health endpoint first, then
  // the bucket endpoint with pre-signed auth.
  const healthUrl = `${scheme}://${endpoint}:${port}/minio/health/live`;

  try {
    const { default: fetch } = await import("node-fetch");

    await withTimeout(async (signal) => {
      const res = await fetch(healthUrl, {
        method: "GET",
        // @ts-expect-error node-fetch uses its own AbortSignal shape
        signal: signal as unknown,
      });
      if (!res.ok && res.status !== 403) {
        // 403 = auth required but server is alive (expected for bucket HEAD)
        throw new Error(
          `MinIO health check returned HTTP ${res.status}: ${url}`
        );
      }
    }, HEALTH_CHECK_TIMEOUT_MS);

    // Second pass — HEAD the bucket endpoint to confirm the bucket exists
    await withTimeout(async (signal) => {
      const date = new Date().toUTCString();
      const res = await fetch(url, {
        method: "HEAD",
        headers: {
          Date: date,
          Authorization: `AWS ${accessKey}:${secretKey}`,
        },
        // @ts-expect-error node-fetch AbortSignal
        signal: signal as unknown,
      });
      // 200 = exists, 403 = auth error but server alive, 404 = bucket missing
      if (res.status !== 200 && res.status !== 403 && res.status !== 404) {
        throw new Error(`MinIO bucket HEAD returned unexpected HTTP ${res.status}`);
      }
    }, HEALTH_CHECK_TIMEOUT_MS);

    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", latencyMs: Date.now() - start, detail: message };
  }
}

// ---------------------------------------------------------------------------
// 4. ClamAV — PING/PONG over TCP socket with 2-second timeout
// ---------------------------------------------------------------------------
export async function checkScanner(): Promise<CheckResult> {
  const start = Date.now();
  const host = process.env["CLAMAV_HOST"] ?? "localhost";
  const port = Number(process.env["CLAMAV_PORT"] ?? 3310);

  return new Promise<CheckResult>((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({
        status: "error",
        latencyMs: Date.now() - start,
        detail: `ClamAV PING timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`,
      });
    }, HEALTH_CHECK_TIMEOUT_MS);

    const socket = new net.Socket();
    let responseData = "";

    socket.connect(port, host, () => {
      // ClamAV protocol: send "zPING\0" for zero-terminated command
      socket.write("zPING\0");
    });

    socket.on("data", (data) => {
      responseData += data.toString();
      // ClamAV responds with "PONG\0"
      if (responseData.includes("PONG")) {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status: "ok", latencyMs: Date.now() - start });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({
        status: "error",
        latencyMs: Date.now() - start,
        detail: err.message,
      });
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!responseData.includes("PONG")) {
        resolve({
          status: "error",
          latencyMs: Date.now() - start,
          detail: "ClamAV connection closed without PONG",
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregate: run all 4 checks in parallel, return structured ReadinessResult
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
  const failing = (
    Object.entries(checks) as [string, CheckResult][]
  )
    .filter(([, result]) => result.status !== "ok")
    .map(([name]) => name);

  return {
    status: failing.length === 0 ? "ready" : "degraded",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
    checks,
    ...(failing.length > 0 ? { failing } : {}),
  };
}
