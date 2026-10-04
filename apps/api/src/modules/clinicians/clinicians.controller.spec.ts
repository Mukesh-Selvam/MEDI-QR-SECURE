import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updatedRows: [{ id: "52e46930-500d-4605-bbac-7cb3ace9426c", isVerified: true }],
  logInTransaction: vi.fn(),
  commitTransactionHash: vi.fn(),
  hashIp: vi.fn(() => "opaque-ip-hash"),
  transaction: vi.fn(),
}));

vi.mock("../../database/index.js", () => ({
  db: {
    transaction: state.transaction,
  },
}));

vi.mock("../../database/schema.js", () => ({
  clinicians: { id: "id", isVerified: "isVerified" },
}));

import { CliniciansController } from "./clinicians.controller.js";

describe("CliniciansController verification boundary", () => {
  let controller: CliniciansController;
  const audit = {
    hashIp: state.hashIp,
    logInTransaction: state.logInTransaction,
    commitTransactionHash: state.commitTransactionHash,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.updatedRows = [{ id: "52e46930-500d-4605-bbac-7cb3ace9426c", isVerified: true }];
    state.logInTransaction.mockResolvedValue("audit-chain-hash");
    state.transaction.mockImplementation(async (operation) =>
      operation({
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => state.updatedRows,
            }),
          }),
        }),
      })
    );
    controller = new CliniciansController(audit);
  });

  it("rejects clinician verification changes by non-platform administrators", async () => {
    await expect(
      controller.setVerification(
        "52e46930-500d-4605-bbac-7cb3ace9426c",
        { isVerified: true },
        { id: "facility-admin-id", role: "facility-admin" },
        { ip: "127.0.0.1", headers: {} } as never
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(state.transaction).not.toHaveBeenCalled();
  });

  it("validates the target and update payload before writing", async () => {
    await expect(
      controller.setVerification(
        "not-a-uuid",
        { isVerified: true },
        { id: "platform-admin-id", role: "platform-admin" },
        { ip: "127.0.0.1", headers: {} } as never
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.setVerification(
        "52e46930-500d-4605-bbac-7cb3ace9426c",
        { isVerified: true, verifiedBy: "attacker" },
        { id: "platform-admin-id", role: "platform-admin" },
        { ip: "127.0.0.1", headers: {} } as never
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(state.transaction).not.toHaveBeenCalled();
  });

  it("updates and audits verification inside one transaction", async () => {
    const result = await controller.setVerification(
      "52e46930-500d-4605-bbac-7cb3ace9426c",
      { isVerified: true },
      { id: "platform-admin-id", role: "platform-admin" },
      { ip: "127.0.0.1", headers: { "user-agent": "unit-test" } } as never
    );

    expect(result).toEqual(state.updatedRows[0]);
    expect(state.logInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "platform-admin-id",
        action: "CLINICIAN_VERIFIED",
        resourceType: "clinician",
        resourceId: "52e46930-500d-4605-bbac-7cb3ace9426c",
      }),
      expect.any(Object)
    );
    expect(state.commitTransactionHash).toHaveBeenCalledWith("audit-chain-hash");
  });
});
