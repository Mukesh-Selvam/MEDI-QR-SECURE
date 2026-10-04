import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    STORAGE_ENDPOINT: "storage.test.invalid",
    STORAGE_PORT: 9000,
    STORAGE_USE_SSL: false,
    STORAGE_REGION: "ap-south-1",
    STORAGE_ACCESS_KEY: "test-access-key",
    STORAGE_SECRET_KEY: "test-secret-key",
  },
}));

import { StorageService, PRESIGNED_URL_EXPIRY_SECONDS } from "../storage/storage.service.js";

describe("StorageService presigned GET URLs", () => {
  it("signs URLs for exactly five minutes and returns the matching expiry time", async () => {
    const storage = new StorageService();
    storage.onModuleInit();

    const startedAt = Date.now();
    const result = await storage.generatePresignedGetUrl(
      "documents",
      "d/test-document-id",
      "ignored-name.pdf",
      "application/pdf"
    );
    const signedAt = Date.now();
    const url = new URL(result.url);

    expect(PRESIGNED_URL_EXPIRY_SECONDS).toBe(300);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + PRESIGNED_URL_EXPIRY_SECONDS * 1000
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      signedAt + PRESIGNED_URL_EXPIRY_SECONDS * 1000
    );
    expect(url.origin).toBe("http://storage.test.invalid:9000");
  });
});
