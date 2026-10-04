import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the env module BEFORE any other import that transitively reads it.
// This prevents the module-level side-effect (dotenv load + process.exit)
// from firing during unit tests.
vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    DB_HOST: "127.0.0.1",
    DB_PORT: 5432,
    DB_NAME: "mediqr_test",
    DB_USER: "mediqr_user",
    DB_PASSWORD: "testpassword",
    DB_SSL_ENABLED: false,
    DB_MAX_CONNECTIONS: 5,
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
    STORAGE_ENDPOINT: "127.0.0.1",
    STORAGE_PORT: 9000,
    STORAGE_USE_SSL: false,
    STORAGE_ACCESS_KEY: "minioadmin",
    STORAGE_SECRET_KEY: "minioadmin",
    STORAGE_BUCKET_DOCUMENTS: "mediqr-documents",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: 3310,
  },
  on: vi.fn().mockReturnThis(),
}));

import { HealthController } from "./health.controller.js";
import * as checks from "./health.checks.js";
import type { ReadinessResult } from "./health.types.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal FastifyReply mock
// ---------------------------------------------------------------------------
function makeReplyMock() {
  const mock = { statusCode: 200 };
  return mock as unknown as import("fastify").FastifyReply;
}

// ---------------------------------------------------------------------------
// Liveness tests — should NEVER depend on external services
// ---------------------------------------------------------------------------
describe("HealthController – getLiveness()", () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it("returns status ok", () => {
    const result = controller.getLiveness();
    expect(result.status).toBe("ok");
  });

  it("returns version 0.1.0", () => {
    expect(controller.getLiveness().version).toBe("0.1.0");
  });

  it("returns a valid ISO timestamp", () => {
    const { timestamp } = controller.getLiveness();
    expect(() => new Date(timestamp)).not.toThrow();
    expect(new Date(timestamp).getTime()).toBeGreaterThan(0);
  });

  it("returns uptimeSeconds as a non-negative integer", () => {
    const { uptimeSeconds } = controller.getLiveness();
    expect(Number.isInteger(uptimeSeconds)).toBe(true);
    expect(uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Readiness tests — mock runAllChecks to isolate controller logic
// ---------------------------------------------------------------------------
describe("HealthController – getReadiness()", () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
    vi.restoreAllMocks();
  });

  it("returns HTTP 200 and status=ready when all checks pass", async () => {
    const allOk: ReadinessResult = {
      status: "ready",
      timestamp: new Date().toISOString(),
      durationMs: 42,
      checks: {
        database: { status: "ok", latencyMs: 10 },
        redis: { status: "ok", latencyMs: 5 },
        storage: { status: "ok", latencyMs: 15 },
        scanner: { status: "ok", latencyMs: 8 },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(allOk);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(result.status).toBe("ready");
    expect(reply.statusCode).toBe(200);
    expect(result.failing).toBeUndefined();
  });

  it("returns HTTP 503 and status=degraded when database fails", async () => {
    const dbDown: ReadinessResult = {
      status: "degraded",
      timestamp: new Date().toISOString(),
      durationMs: 2001,
      failing: ["database"],
      checks: {
        database: {
          status: "error",
          latencyMs: 2001,
          detail: "connect ECONNREFUSED 127.0.0.1:5432",
        },
        redis: { status: "ok", latencyMs: 5 },
        storage: { status: "ok", latencyMs: 15 },
        scanner: { status: "ok", latencyMs: 8 },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(dbDown);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(reply.statusCode).toBe(503);
    expect(result.status).toBe("degraded");
    expect(result.failing).toContain("database");
    expect(result.checks.database.status).toBe("error");
  });

  it("returns HTTP 503 and names redis when Redis fails", async () => {
    const redisDown: ReadinessResult = {
      status: "degraded",
      timestamp: new Date().toISOString(),
      durationMs: 2001,
      failing: ["redis"],
      checks: {
        database: { status: "ok", latencyMs: 10 },
        redis: {
          status: "error",
          latencyMs: 2001,
          detail: "connect ECONNREFUSED 127.0.0.1:6379",
        },
        storage: { status: "ok", latencyMs: 15 },
        scanner: { status: "ok", latencyMs: 8 },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(redisDown);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(reply.statusCode).toBe(503);
    expect(result.failing).toContain("redis");
    expect(result.checks.redis.status).toBe("error");
  });

  it("returns HTTP 503 and names storage when MinIO fails", async () => {
    const storageDown: ReadinessResult = {
      status: "degraded",
      timestamp: new Date().toISOString(),
      durationMs: 2001,
      failing: ["storage"],
      checks: {
        database: { status: "ok", latencyMs: 10 },
        redis: { status: "ok", latencyMs: 5 },
        storage: {
          status: "error",
          latencyMs: 2001,
          detail: "fetch failed: connect ECONNREFUSED 127.0.0.1:9000",
        },
        scanner: { status: "ok", latencyMs: 8 },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(storageDown);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(reply.statusCode).toBe(503);
    expect(result.failing).toContain("storage");
    expect(result.checks.storage.status).toBe("error");
  });

  it("returns HTTP 503 and names scanner when ClamAV fails", async () => {
    const scannerDown: ReadinessResult = {
      status: "degraded",
      timestamp: new Date().toISOString(),
      durationMs: 2001,
      failing: ["scanner"],
      checks: {
        database: { status: "ok", latencyMs: 10 },
        redis: { status: "ok", latencyMs: 5 },
        storage: { status: "ok", latencyMs: 15 },
        scanner: {
          status: "error",
          latencyMs: 2001,
          detail: "connect ECONNREFUSED 127.0.0.1:3310",
        },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(scannerDown);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(reply.statusCode).toBe(503);
    expect(result.failing).toContain("scanner");
    expect(result.checks.scanner.status).toBe("error");
  });

  it("names ALL failing checks when multiple services are down", async () => {
    const multiDown: ReadinessResult = {
      status: "degraded",
      timestamp: new Date().toISOString(),
      durationMs: 2005,
      failing: ["database", "redis", "storage", "scanner"],
      checks: {
        database: {
          status: "error",
          latencyMs: 2001,
          detail: "ECONNREFUSED",
        },
        redis: { status: "error", latencyMs: 2001, detail: "ECONNREFUSED" },
        storage: { status: "error", latencyMs: 2001, detail: "fetch failed" },
        scanner: {
          status: "error",
          latencyMs: 2001,
          detail: "ClamAV PING timed out",
        },
      },
    };
    vi.spyOn(checks, "runAllChecks").mockResolvedValue(multiDown);

    const reply = makeReplyMock();
    const result = await controller.getReadiness(reply);

    expect(reply.statusCode).toBe(503);
    expect(result.failing).toHaveLength(4);
    expect(result.failing).toEqual(
      expect.arrayContaining(["database", "redis", "storage", "scanner"])
    );
  });
});
