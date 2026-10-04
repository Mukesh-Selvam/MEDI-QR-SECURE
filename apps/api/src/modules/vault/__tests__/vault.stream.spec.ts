import { describe, expect, it, vi } from "vitest";
import { POLICY_KEY } from "../../auth/decorators/policy.decorator.js";
import type { AuthenticatedUser } from "../../auth/decorators/current-user.decorator.js";
import type { VaultService } from "../vault.service.js";
import { VaultController } from "../vault.controller.js";

describe("VaultController stream route", () => {
  it("uses the same document-read policy declaration as the presigned URL route", () => {
    expect(Reflect.getMetadata(POLICY_KEY, VaultController.prototype.getViewUrl)).toEqual({
      resource: "document",
      action: "read",
    });
    expect(Reflect.getMetadata(POLICY_KEY, VaultController.prototype.streamDocument)).toEqual({
      resource: "document",
      action: "read",
    });
  });

  it("sets no-store, nosniff, and the supported fixed content type", async () => {
    const service = {
      getDecryptedDocument: vi.fn().mockResolvedValue({
        buffer: Buffer.from("document"),
        mimeType: "application/pdf",
        sourceLabel: "patient-uploaded",
        patientId: "00000000-0000-0000-0000-000000000003",
      }),
    } as unknown as VaultService;
    const controller = new VaultController(service);
    const reply = { header: vi.fn() };
    const request = { ip: "127.0.0.1", query: {} };
    const user: AuthenticatedUser = {
      id: "00000000-0000-0000-0000-000000000001",
      sub: "user-sub",
      role: "patient",
    };

    const result = await controller.streamDocument(
      "00000000-0000-0000-0000-000000000002",
      request as never,
      reply as never,
      user
    );

    expect(result).toEqual(Buffer.from("document"));
    expect(service.getDecryptedDocument).toHaveBeenCalledOnce();
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/pdf");
  });
});
