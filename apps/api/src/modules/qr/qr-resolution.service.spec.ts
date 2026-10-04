import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { QrResolutionService } from "./qr-resolution.service.js";

describe("QrResolutionService rate limits", () => {
  it("limits requests per IP before looking up a QR credential", async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(31),
      expire: vi.fn(),
      set: vi.fn(),
      getdel: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;
    const service = new QrResolutionService(redis);

    await expect(
      service.resolve("not-a-token", "8c370d16-6f99-4d1f-8e33-28345432001b", "127.0.0.1")
    ).rejects.toMatchObject({ status: 429 });
    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("limits requests per opaque token independently of the client IP", async () => {
    const redis = {
      incr: vi.fn(async (key: string) => key.includes(":token:") ? 11 : 1),
      expire: vi.fn(),
      set: vi.fn(),
      getdel: vi.fn(),
      quit: vi.fn(),
    } as unknown as Redis;
    const service = new QrResolutionService(redis);

    await expect(
      service.resolve("not-a-token", "8c370d16-6f99-4d1f-8e33-28345432001b", "127.0.0.1")
    ).rejects.toMatchObject({ status: 429 });
    expect(redis.incr).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
