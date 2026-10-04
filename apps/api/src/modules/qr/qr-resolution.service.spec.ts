import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { QrResolutionService } from "./qr-resolution.service.js";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[],
  select: vi.fn(),
  auditLog: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock("../../database/index.js", () => ({
  db: { select: mocks.select },
}));

function queryBuilder(result: unknown): object {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

function buildService(redisOverrides: Partial<Redis> = {}) {
  const redis = {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    getdel: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue("OK"),
    ...redisOverrides,
  } as unknown as Redis;
  const audit = {
    log: mocks.auditLog,
    hashIp: mocks.hashIp,
  } as unknown as AuditService;
  return { service: new QrResolutionService(redis, audit), redis };
}

const validToken = Buffer.from("0123456789abcdef").toString("base64url");
const resolutionId = "8c370d16-6f99-4d1f-8e33-28345432001b";
const credentialId = "9c370d16-6f99-4d1f-8e33-28345432001b";
const clientIp = "203.0.113.10";

describe("QrResolutionService audit and rate limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
    mocks.select.mockImplementation(() =>
      queryBuilder(mocks.selectResults.shift())
    );
    mocks.auditLog.mockResolvedValue(undefined);
    mocks.hashIp.mockReturnValue("keyed-ip-hash");
  });

  it.each([
    { status: undefined, action: "QR_RESOLUTION_UNKNOWN", outcome: "DENIED" },
    { status: "rotated", action: "QR_RESOLUTION_EXPIRED", outcome: "DENIED" },
    { status: "revoked", action: "QR_RESOLUTION_REVOKED", outcome: "DENIED" },
    { status: "active", action: "QR_RESOLUTION_SUCCESS", outcome: "SUCCESS" },
  ] as const)(
    "audits $action without storing the submitted token",
    async ({ status, action, outcome }) => {
      mocks.selectResults = [
        status ? [{ id: credentialId, status }] : [],
      ];
      const { service } = buildService();

      await expect(
        service.resolve(validToken, resolutionId, clientIp)
      ).resolves.toBeUndefined();

      expect(mocks.hashIp).toHaveBeenCalledWith(clientIp);
      expect(mocks.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          resourceType: "qr_resolution",
          resourceId: resolutionId,
          outcome,
          ipHash: "keyed-ip-hash",
        })
      );
      const auditEvent = mocks.auditLog.mock.calls[0]?.[0];
      expect(JSON.stringify(auditEvent)).not.toContain(validToken);
      expect(auditEvent).not.toHaveProperty("actorId");
    }
  );

  it("audits and does not expose an IP-rate-limited resolution", async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(31),
      expire: vi.fn(),
      set: vi.fn(),
      getdel: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;
    const { service } = buildService(redis);

    await expect(
      service.resolve(validToken, resolutionId, clientIp)
    ).resolves.toBeUndefined();
    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "QR_RESOLUTION_RATE_LIMITED",
        outcome: "DENIED",
        resourceId: resolutionId,
      })
    );
  });

  it("audits token-rate-limited attempts without looking up credentials", async () => {
    const redis = {
      incr: vi.fn(async (key: string) => (key.includes(":token:") ? 11 : 1)),
      expire: vi.fn(),
      set: vi.fn(),
      getdel: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;
    const { service } = buildService(redis);

    await expect(
      service.resolve(validToken, resolutionId, clientIp)
    ).resolves.toBeUndefined();
    expect(redis.incr).toHaveBeenCalledTimes(2);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "QR_RESOLUTION_RATE_LIMITED",
        outcome: "DENIED",
      })
    );
  });

  it("removes a newly created resolution handle if its audit write fails", async () => {
    mocks.selectResults = [[{ id: credentialId, status: "active" }]];
    mocks.auditLog.mockRejectedValue(new Error("audit insert failed"));
    const { service, redis } = buildService();

    await expect(
      service.resolve(validToken, resolutionId, clientIp)
    ).rejects.toThrow("audit insert failed");
    expect(redis.del).toHaveBeenCalledWith(`qr:resolution:${resolutionId}`);
  });

  it("audits an infrastructure failure before rethrowing it", async () => {
    const redis = {
      incr: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      expire: vi.fn(),
      set: vi.fn(),
      getdel: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;
    const { service } = buildService(redis);

    await expect(
      service.resolve(validToken, resolutionId, clientIp)
    ).rejects.toThrow("redis unavailable");
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "QR_RESOLUTION_FAILURE",
        outcome: "FAILURE",
      })
    );
  });
});
