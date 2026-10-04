/**
 * auth.service.spec.ts — OTP flow unit tests
 *
 * Tests (Vitest, no live Docker required):
 * 1. sendOtp: valid phone -> dispatches OTP, stores hash in Redis
 * 2. sendOtp: invalid phone -> BadRequestException
 * 3. verifyOtp: valid OTP -> issues cookies (3 cookies set)
 * 4. verifyOtp: OTP is single-use -> second attempt fails
 * 5. verifyOtp: expired OTP (key not in Redis) -> BadRequestException
 * 6. verifyOtp: wrong OTP -> BadRequestException
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException, HttpException, Logger } from "@nestjs/common";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Mock env BEFORE importing AuthService
// ---------------------------------------------------------------------------
vi.mock("../../../config/env.js", () => ({
  env: {
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    REDIS_PASSWORD: "test",
    SESSION_SECRET: "test_session_secret_min_32_chars_abcdefgh",
    AUDIT_HMAC_KEY: "test_audit_hmac_key_min_32_chars_abcdefgh",
    NODE_ENV: "test",
  },
}));

// ---------------------------------------------------------------------------
// In-memory Redis mock
// ---------------------------------------------------------------------------
const redisStore = new Map<string, string>();

vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) { if (redisStore.delete(k)) count++; }
      return count;
    }),
    incr: vi.fn(async (key: string) => {
      const curr = parseInt(redisStore.get(key) ?? "0") + 1;
      redisStore.set(key, String(curr));
      return curr;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => -2),
    on: vi.fn().mockReturnThis(),
  }));
  return { Redis: MockRedis };
});

// ---------------------------------------------------------------------------
// Minimal Drizzle DB mock — supports both query builder and relational API
// ---------------------------------------------------------------------------
let mockFindFirstResult: unknown = null;

vi.mock("../../../database/index.js", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(async () => mockFindFirstResult),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          { id: "user-uuid-1234", role: "patient", status: "active", phone: "+919876543210" },
        ]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
}));

vi.mock("../../../database/schema.js", () => ({
  users: { phone: "phone", id: "id" },
  sessions: { userId: "userId", refreshTokenHash: "refreshTokenHash", revokedAt: "revokedAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  gt: vi.fn(),
}));

import { AuthService } from "../auth.service.js";
import type { SmsProvider } from "../providers/sms-provider.interface.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { FastifyReply } from "fastify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSmsProvider(): SmsProvider & { lastOtp: string | null } {
  const provider = {
    lastOtp: null as string | null,
    sendOtp: vi.fn(async (_phone: string, otp: string) => {
      provider.lastOtp = otp;
    }),
  };
  return provider;
}

function makeAuditService(): AuditService {
  return {
    log: vi.fn(async () => {}),
    hashIp: vi.fn(() => "hashed-ip"),
  } as unknown as AuditService;
}

function makeFastifyReply(): FastifyReply {
  return {
    setCookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as FastifyReply;
}

const VALID_PHONE = "+919876543210";
const IP_HASH = "hashed-ip";
const UA = "Vitest/1.0";
const REQUEST_ID = "request-123";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AuthService — OTP flow", () => {
  let sms: ReturnType<typeof makeSmsProvider>;
  let audit: AuditService;
  let service: AuthService;

  beforeEach(() => {
    redisStore.clear();
    mockFindFirstResult = null;
    sms = makeSmsProvider();
    audit = makeAuditService();
    service = new AuthService(sms, audit);
  });

  it("sendOtp: valid Indian mobile number dispatches OTP", async () => {
    const result = await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    expect(result.message).toContain("OTP sent");
    expect(sms.sendOtp).toHaveBeenCalledOnce();
    expect(sms.lastOtp).toMatch(/^\d{6}$/);
  });

  it("sendOtp: invalid phone format throws BadRequestException", async () => {
    await expect(service.sendOtp("9876543210", IP_HASH, REQUEST_ID)).rejects.toThrow(
      BadRequestException
    );
    await expect(service.sendOtp("+1-800-555-0100", IP_HASH, REQUEST_ID)).rejects.toThrow(
      BadRequestException
    );
  });

  it("sendOtp: stores only the HMAC — not the raw OTP — in Redis", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const phoneHash = createHash("sha256").update(VALID_PHONE).digest("hex");
    const stored = redisStore.get(`otp:hmac:${phoneHash}`);
    expect(stored).toBeTruthy();
    // The stored value must NOT be the 6-digit OTP itself
    expect(stored).not.toMatch(/^\d{6}$/);
    // Must be a hex HMAC (64 chars)
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(sms.lastOtp);
  });

  it("sendOtp: logs the request ID without logging a phone number or blind index", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log");
    const phoneHash = createHash("sha256").update(VALID_PHONE).digest("hex");

    try {
      await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
      expect(logSpy).toHaveBeenCalledWith(`OTP dispatched for request ${REQUEST_ID}`);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(VALID_PHONE));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(phoneHash));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("verifyOtp: wrong OTP throws BadRequestException", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const reply = makeFastifyReply();
    await expect(
      service.verifyOtp(VALID_PHONE, "000000", IP_HASH, UA, reply)
    ).rejects.toThrow(BadRequestException);
  });

  it("verifyOtp: valid OTP succeeds and sets 3 cookies", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const correctOtp = sms.lastOtp!;
    const reply = makeFastifyReply();
    const result = await service.verifyOtp(
      VALID_PHONE,
      correctOtp,
      IP_HASH,
      UA,
      reply
    );
    expect(result.message).toContain("successful");
    expect(result.csrfToken).toBeTruthy();
    expect(result.csrfToken.length).toBeGreaterThan(16);
    // access cookie + refresh cookie + csrf cookie
    expect(reply.setCookie).toHaveBeenCalledTimes(3);
  });

  it("verifyOtp: refuses to authenticate staff through the patient OTP flow", async () => {
    mockFindFirstResult = {
      id: "staff-user-id",
      role: "clinician",
      status: "active",
      phone: VALID_PHONE,
    };
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);

    await expect(
      service.verifyOtp(
        VALID_PHONE,
        sms.lastOtp!,
        IP_HASH,
        UA,
        makeFastifyReply()
      )
    ).rejects.toThrow(/Staff must authenticate through OIDC/);
  });

  it("verifyOtp: OTP is single-use — second attempt throws", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const correctOtp = sms.lastOtp!;
    await service.verifyOtp(VALID_PHONE, correctOtp, IP_HASH, UA, makeFastifyReply());

    // Second attempt — OTP key deleted from Redis
    await expect(
      service.verifyOtp(VALID_PHONE, correctOtp, IP_HASH, UA, makeFastifyReply())
    ).rejects.toThrow(BadRequestException);
  });

  it("verifyOtp: expired OTP (key not in Redis) throws BadRequestException", async () => {
    const reply = makeFastifyReply();
    await expect(
      service.verifyOtp(VALID_PHONE, "123456", IP_HASH, UA, reply)
    ).rejects.toThrow(BadRequestException);
  });

  it("sendOtp: 4th request for same phone within 10 min returns HTTP 429", async () => {
    const phoneHash = createHash("sha256").update(VALID_PHONE).digest("hex");
    // Simulate 3 prior sends
    redisStore.set(`otp:send:${phoneHash}`, "3");
    // 4th send should be rate-limited
    await expect(service.sendOtp(VALID_PHONE, "diff-ip-hash", REQUEST_ID)).rejects.toThrow(
      HttpException
    );
  });

  it("verifyOtp: exceeding 5 attempts invalidates the code and triggers lockout (Condition 1)", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const phoneHash = createHash("sha256").update(VALID_PHONE).digest("hex");

    for (let i = 1; i <= 4; i++) {
      await expect(
        service.verifyOtp(VALID_PHONE, "000000", IP_HASH, UA, makeFastifyReply())
      ).rejects.toThrow(BadRequestException);
    }

    // 5th attempt throws HttpException (lockout) and wipes code
    await expect(
      service.verifyOtp(VALID_PHONE, "000000", IP_HASH, UA, makeFastifyReply())
    ).rejects.toThrow(HttpException);

    // Code must be invalidated
    expect(redisStore.get(`otp:hmac:${phoneHash}`)).toBeUndefined();
  });

  it("sendOtp: issuing a new code invalidates previous code (Condition 1)", async () => {
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const firstOtp = sms.lastOtp!;
    const phoneHash = createHash("sha256").update(VALID_PHONE).digest("hex");
    const firstHmac = redisStore.get(`otp:hmac:${phoneHash}`);

    // Re-issue
    await service.sendOtp(VALID_PHONE, IP_HASH, REQUEST_ID);
    const _secondOtp = sms.lastOtp!;
    const secondHmac = redisStore.get(`otp:hmac:${phoneHash}`);

    expect(secondHmac).not.toBe(firstHmac);

    // Old code fails
    await expect(
      service.verifyOtp(VALID_PHONE, firstOtp, IP_HASH, UA, makeFastifyReply())
    ).rejects.toThrow(BadRequestException);
  });
});
