import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../../config/env.js";
import {
  checkDatabase,
  checkRedis,
  checkStorage,
  checkScanner,
  runAllChecks,
} from "./health.checks.js";

const REFUSED_PORT = {
  database: 58001,
  redis: 58002,
  storage: 58003,
  scanner: 58004,
} as const;

describe("Health service probes (integration)", () => {
  beforeAll(() => {
    env.REDIS_HOST = "127.0.0.1";
    env.STORAGE_ENDPOINT = "127.0.0.1";
    env.CLAMAV_HOST = "127.0.0.1";
  });

  it("reports all service containers as healthy", async () => {
    const result = await runAllChecks();
    expect(result.status).toBe("ready");
    expect(result.checks.database.status).toBe("ok");
    expect(result.checks.redis.status).toBe("ok");
    expect(result.checks.storage.status).toBe("ok");
    expect(result.checks.scanner.status).toBe("ok");
  }, 12000);

  it("reports an unavailable PostgreSQL instance", async () => {
    env.DB_HOST = "127.0.0.1";
    env.DB_PORT = REFUSED_PORT.database;

    const result = await checkDatabase();
    expect(result.status).toBe("error");
    expect(result.detail).toBeTruthy();
  });

  it("reports an unavailable Redis instance", async () => {
    env.REDIS_HOST = "127.0.0.1";
    env.REDIS_PORT = REFUSED_PORT.redis;

    const result = await checkRedis();
    expect(result.status).toBe("error");
    expect(result.detail).toBeTruthy();
  });

  it("reports an unavailable MinIO instance", async () => {
    env.STORAGE_ENDPOINT = "127.0.0.1";
    env.STORAGE_PORT = REFUSED_PORT.storage;

    const result = await checkStorage();
    expect(result.status).toBe("error");
    expect(result.detail).toBeTruthy();
  });

  it("reports an unavailable ClamAV instance", async () => {
    env.CLAMAV_HOST = "127.0.0.1";
    env.CLAMAV_PORT = REFUSED_PORT.scanner;

    const result = await checkScanner();
    expect(result.status).toBe("error");
    expect(result.detail).toBeTruthy();
  });

  it("reports all failed services in the aggregate readiness response", async () => {
    env.DB_HOST = "127.0.0.1";
    env.DB_PORT = REFUSED_PORT.database;
    env.REDIS_HOST = "127.0.0.1";
    env.REDIS_PORT = REFUSED_PORT.redis;
    env.STORAGE_ENDPOINT = "127.0.0.1";
    env.STORAGE_PORT = REFUSED_PORT.storage;
    env.CLAMAV_HOST = "127.0.0.1";
    env.CLAMAV_PORT = REFUSED_PORT.scanner;

    const result = await runAllChecks();
    expect(result.status).toBe("degraded");
    expect(result.checks.database.status).toBe("error");
    expect(result.checks.redis.status).toBe("error");
    expect(result.checks.storage.status).toBe("error");
    expect(result.checks.scanner.status).toBe("error");
    expect(result.checks.scanner.detail).toBeTruthy();
  }, 12000);
});
