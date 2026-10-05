import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import type { EmergencyProfileInput } from "./emergency-profile.schema.js";

const state = vi.hoisted(() => ({
  patient: { id: "patient-id", userId: "patient-user-id" } as
    { id: string; userId: string } | undefined,
  profile: undefined as
    | {
        encryptedPayload: string;
        wrappedDek: string;
        kmsKeyId: string;
        iv: string;
        authTag: string;
        sha256Plaintext: string;
        enabled: boolean;
      }
    | undefined,
  insertedValues: undefined as Record<string, unknown> | undefined,
  profileEnabled: undefined as boolean | undefined,
  audit: vi.fn(),
  hashIp: vi.fn(() => "opaque-ip-hash"),
  guardian: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn()
}));

const tables = vi.hoisted(() => ({
  emergencyAccessRequests: {
    patientId: "patientId",
    status: "status",
    expiresAt: "expiresAt",
    id: "id"
  },
  emergencyProfiles: { patientId: "patientId", enabled: "enabled" },
  patients: { id: "id", userId: "userId" }
}));

vi.mock("../../database/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.patient ? [state.patient] : [])
        })
      })
    }),
    transaction: async (callback: (tx: object) => Promise<unknown>) =>
      callback({
        select: () => {
          let selectedTable: unknown;
          const query = {
            from: (table: unknown) => {
              selectedTable = table;
              return query;
            },
            where: () => query,
            for: () => query,
            limit: async () => {
              if (selectedTable === tables.patients) {
                return state.patient ? [{ id: state.patient.id }] : [];
              }
              if (selectedTable === tables.emergencyProfiles) {
                return state.profileEnabled === undefined
                  ? []
                  : [{ enabled: state.profileEnabled }];
              }
              return [];
            }
          };
          return query;
        },
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            state.insertedValues = values;
            return {
              onConflictDoUpdate: () => ({
                returning: async () => [
                  {
                    patientId: "patient-id",
                    enabled: values["enabled"],
                    updatedAt: new Date("2026-01-01T00:00:00Z")
                  }
                ]
              })
            };
          }
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => []
            })
          })
        })
      })
  }
}));

vi.mock("../../database/schema.js", () => ({
  emergencyAccessRequests: tables.emergencyAccessRequests,
  emergencyProfiles: tables.emergencyProfiles,
  patients: tables.patients
}));

vi.mock("../auth/patient-access.js", () => ({
  isVerifiedGuardianOfPatient: state.guardian
}));

import { EmergencyProfileService } from "./emergency-profile.service.js";

const profileInput: EmergencyProfileInput = {
  bloodGroup: "O+",
  allergies: ["FAKE allergy"],
  emergencyContacts: [
    { name: "FAKE Contact", relationship: "guardian", phone: "+910000000000" }
  ],
  enabled: true
};

describe("EmergencyProfileService", () => {
  let service: EmergencyProfileService;
  const patientActor = {
    id: "patient-user-id",
    role: "patient"
  } as AuthenticatedUser;

  beforeEach(() => {
    vi.clearAllMocks();
    state.patient = { id: "patient-id", userId: "patient-user-id" };
    state.insertedValues = undefined;
    state.profileEnabled = undefined;
    state.encrypt.mockResolvedValue({
      ciphertext: Buffer.from("ciphertext"),
      wrappedDek: "wrapped-key",
      kmsKeyId: "test-key",
      iv: "test-iv",
      authTag: "test-tag",
      sha256Plaintext: "a".repeat(64)
    });
    state.audit.mockResolvedValue("chain-hash");
    service = new EmergencyProfileService(
      { encrypt: state.encrypt, decrypt: state.decrypt } as never,
      { hashIp: state.hashIp, logInTransaction: state.audit } as never
    );
  });

  it("encrypts declared fields and commits the audit event with the profile update", async () => {
    const result = await service.update(
      "patient-id",
      patientActor,
      profileInput,
      "127.0.0.1",
      "unit-test"
    );

    expect(result).toMatchObject({ patientId: "patient-id", enabled: true });
    expect(state.insertedValues).toMatchObject({
      patientId: "patient-id",
      encryptedPayload: Buffer.from("ciphertext").toString("base64"),
      enabled: true
    });
    expect(JSON.stringify(state.insertedValues)).not.toContain("FAKE allergy");
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMERGENCY_PROFILE_UPDATED",
        resourceId: "patient-id",
        actorId: patientActor.id
      }),
      expect.any(Object)
    );
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMERGENCY_PROFILE_ENABLED_FALSE_TO_TRUE",
        resourceId: "patient-id",
        actorId: patientActor.id
      }),
      expect.any(Object)
    );
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain(
      "FAKE allergy"
    );
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain(
      "FAKE Contact"
    );
  });

  it("audits profile reads in the transaction without recording profile contents", async () => {
    const result = await service.read(
      "patient-id",
      patientActor,
      "127.0.0.1",
      "unit-test"
    );

    expect(result).toEqual({
      bloodGroup: "",
      allergies: [],
      emergencyContacts: [],
      enabled: false
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMERGENCY_PROFILE_ACCESSED",
        resourceId: "patient-id",
        actorId: patientActor.id,
        ipHash: "opaque-ip-hash"
      }),
      expect.any(Object)
    );
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain(
      "FAKE allergy"
    );
  });

  it("audits an enabled-to-disabled transition with both states and no contents", async () => {
    state.profileEnabled = true;
    await service.update(
      "patient-id",
      patientActor,
      { ...profileInput, enabled: false },
      "127.0.0.1",
      undefined
    );

    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMERGENCY_PROFILE_ENABLED_TRUE_TO_FALSE",
        resourceId: "patient-id"
      }),
      expect.any(Object)
    );
  });

  it("rejects an unrelated user before writing profile data or audit", async () => {
    const actor = {
      id: "another-user-id",
      role: "patient"
    } as AuthenticatedUser;

    await expect(
      service.update("patient-id", actor, profileInput, "127.0.0.1", undefined)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.encrypt).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("does not distinguish a missing patient from a disallowed profile owner", async () => {
    const patientActor = {
      id: "patient-user-id",
      role: "patient"
    } as AuthenticatedUser;
    const unrelatedActor = {
      id: "another-user-id",
      role: "patient"
    } as AuthenticatedUser;

    const rejectionMessage = async (
      request: Promise<unknown>
    ): Promise<string> => {
      try {
        await request;
      } catch (error) {
        if (error instanceof ForbiddenException) return error.message;
        throw error;
      }
      throw new Error("Expected emergency-profile access to be denied.");
    };

    state.patient = undefined;
    const missingMessage = await rejectionMessage(
      service.read("missing-patient-id", patientActor, "127.0.0.1", undefined)
    );
    state.patient = { id: "patient-id", userId: "patient-user-id" };
    const deniedMessage = await rejectionMessage(
      service.read("patient-id", unrelatedActor, "127.0.0.1", undefined)
    );

    expect(missingMessage).toBe(deniedMessage);
  });

  it("allows a guardian only when the database confirms an active relationship", async () => {
    state.guardian.mockResolvedValue(true);
    const guardian = {
      id: "guardian-user-id",
      role: "guardian"
    } as AuthenticatedUser;

    await service.update(
      "patient-id",
      guardian,
      profileInput,
      "127.0.0.1",
      undefined
    );

    expect(state.guardian).toHaveBeenCalledWith(
      "guardian-user-id",
      "patient-id"
    );
    state.guardian.mockResolvedValue(false);
    await expect(
      service.update(
        "patient-id",
        guardian,
        profileInput,
        "127.0.0.1",
        undefined
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies the profile change if its audit append fails", async () => {
    state.audit.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.update(
        "patient-id",
        patientActor,
        profileInput,
        "127.0.0.1",
        undefined
      )
    ).rejects.toThrow("audit unavailable");
  });
});
