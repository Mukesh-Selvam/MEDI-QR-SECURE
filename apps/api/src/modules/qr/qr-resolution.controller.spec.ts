import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { QrResolutionController } from "./qr-resolution.controller.js";
import type { QrResolutionService } from "./qr-resolution.service.js";

describe("QrResolutionController", () => {
  it("returns an identical response for unknown and expired QR values", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const controller = new QrResolutionController({
      resolve,
    } as unknown as QrResolutionService);
    const reply = { header: vi.fn() } as unknown as FastifyReply;
    const request = { ip: "127.0.0.1" } as FastifyRequest;

    const unknown = await controller.resolve(
      { token: "unknown", resolutionId: randomUUID() },
      request,
      reply
    );
    const expired = await controller.resolve(
      { token: "expired", resolutionId: randomUUID() },
      request,
      reply
    );

    expect(unknown).toEqual(expired);
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
  });
});
