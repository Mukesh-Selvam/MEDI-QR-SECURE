import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../auth/decorators/current-user.decorator.js";
import type { VaultService } from "../vault.service.js";
import { VaultController } from "../vault.controller.js";

const patientId = "00000000-0000-0000-0000-000000000003";
const user: AuthenticatedUser = {
  id: "00000000-0000-0000-0000-000000000001",
  sub: "patient-subject",
  role: "patient",
};

function buildController(fields: Record<string, unknown>) {
  const uploadDocument = vi.fn().mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000002",
    status: "quarantined",
  });
  const service = { uploadDocument } as unknown as VaultService;
  const controller = new VaultController(service);
  const request = {
    ip: "127.0.0.1",
    headers: { "x-mediqr-patient-id": patientId },
    file: vi.fn().mockResolvedValue({
      mimetype: "application/pdf",
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, { value }])
      ),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("%PDF-test")),
    }),
  } as unknown as FastifyRequest;
  return { controller, request, uploadDocument };
}

describe("VaultController upload boundary", () => {
  it("ignores a patient-supplied verified-source label and passes only the authenticated role", async () => {
    const { controller, request, uploadDocument } = buildController({
      documentType: "lab",
      patientId,
      documentDate: "2026-09-01T00:00:00.000Z",
      uploadSource: "facility-verified",
    });

    await controller.uploadDocument(request, user);

    const input = uploadDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      patientId,
      uploaderId: user.id,
      uploaderRole: "patient",
      documentType: "lab",
      documentDate: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(input).not.toHaveProperty("uploadSource");
  });

  it.each([
    { documentType: "lab", patientId: "not-a-uuid" },
    { documentType: "unknown", patientId },
    { documentType: "lab", patientId, documentDate: "not-a-date" },
    { documentType: "lab", patientId, notes: "n".repeat(501) },
  ])("rejects invalid multipart metadata without calling the upload service", async (fields) => {
    const { controller, request, uploadDocument } = buildController(fields);

    await expect(controller.uploadDocument(request, user)).rejects.toThrow(
      /Invalid upload metadata/
    );
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("rejects a multipart target that differs from the policy-checked header", async () => {
    const { controller, request, uploadDocument } = buildController({
      documentType: "lab",
      patientId: "00000000-0000-0000-0000-000000000004",
    });

    await expect(controller.uploadDocument(request, user)).rejects.toThrow(
      /authorization target does not match/
    );
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});
