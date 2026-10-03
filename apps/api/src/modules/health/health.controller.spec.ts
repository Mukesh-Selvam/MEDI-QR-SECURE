import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthController } from "./health.controller.js";
import * as checks from "./health.checks.js";
import type { CheckResult, ReadinessResult } from "./health.types.js";

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

// ---------------------------------------------------------------------------
// Anti-stub enforcement tests
//
// These tests FAIL THE BUILD if any check function is a stub that does not
// perform a real network call. They call each exported check function against
// a port that is guaranteed to be closed (58001–58004), and assert that the
// function returns status="error" (proving it actually tried to connect).
//
// A stub that always returns "connected" / "ok" would FAIL these tests.
// ---------------------------------------------------------------------------
describe("Real-call enforcement — checks MUST attempt actual I/O", () => {
  const REFUSED_PORT = {
    db: 58001,
    redis: 58002,
    minio: 58003,
    clamav: 58004,
  } as const;

  it("checkDatabase() returns error when Postgres port is closed (not a stub)", async () => {
    process.env["DB_HOST"] = "127.0.0.1";
    process.env["DB_PORT"] = String(REFUSED_PORT.db);
    process.env["DB_PASSWORD"] = "irrelevant";

    const { checkDatabase } = await import("./health.checks.js");
    const result: CheckResult = await checkDatabase();

    expect(result.status).toBe("error");
    expect(result.detail).toBeDefined();
    expect(result.latencyMs).toBeDefined();
  }, 5000);

  it("checkRedis() returns error when Redis port is closed (not a stub)", async () => {
    process.env["REDIS_HOST"] = "127.0.0.1";
    process.env["REDIS_PORT"] = String(REFUSED_PORT.redis);
    process.env["REDIS_PASSWORD"] = "";

    const { checkRedis } = await import("./health.checks.js");
    const result: CheckResult = await checkRedis();

    expect(result.status).toBe("error");
    expect(result.detail).toBeDefined();
    expect(result.latencyMs).toBeDefined();
  }, 5000);

  it("checkStorage() returns error when MinIO port is closed (not a stub)", async () => {
    process.env["STORAGE_ENDPOINT"] = "127.0.0.1";
    process.env["STORAGE_PORT"] = String(REFUSED_PORT.minio);
    process.env["STORAGE_USE_SSL"] = "false";

    const { checkStorage } = await import("./health.checks.js");
    const result: CheckResult = await checkStorage();

    expect(result.status).toBe("error");
    expect(result.detail).toBeDefined();
    expect(result.latencyMs).toBeDefined();
  }, 5000);

  it("checkScanner() returns error when ClamAV port is closed (not a stub)", async () => {
    process.env["CLAMAV_HOST"] = "127.0.0.1";
    process.env["CLAMAV_PORT"] = String(REFUSED_PORT.clamav);

    const { checkScanner } = await import("./health.checks.js");
    const result: CheckResult = await checkScanner();

    expect(result.status).toBe("error");
    expect(result.detail).toBeDefined();
    expect(result.latencyMs).toBeDefined();
  }, 5000);

  it("runAllChecks() returns degraded with all checks named when all ports closed", async () => {
    process.env["DB_HOST"] = "127.0.0.1";
    process.env["DB_PORT"] = String(REFUSED_PORT.db);
    process.env["REDIS_HOST"] = "127.0.0.1";
    process.env["REDIS_PORT"] = String(REFUSED_PORT.redis);
    process.env["STORAGE_ENDPOINT"] = "127.0.0.1";
    process.env["STORAGE_PORT"] = String(REFUSED_PORT.minio);
    process.env["CLAMAV_HOST"] = "127.0.0.1";
    process.env["CLAMAV_PORT"] = String(REFUSED_PORT.clamav);

    const { runAllChecks } = await import("./health.checks.js");
    const result: ReadinessResult = await runAllChecks();

    expect(result.status).toBe("degraded");
    expect(result.failing).toBeDefined();
    expect(result.failing?.length).toBeGreaterThanOrEqual(1);
    // All 4 checks must report error — proves runAllChecks runs them all
    expect(result.checks.database.status).toBe("error");
    expect(result.checks.redis.status).toBe("error");
    expect(result.checks.storage.status).toBe("error");
    expect(result.checks.scanner.status).toBe("error");
  }, 12000);
});
