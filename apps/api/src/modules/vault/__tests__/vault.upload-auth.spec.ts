import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultCryptoService } from "../crypto/vault-crypto.service.js";
import type { FhirDocumentMapper } from "../fhir/fhir-document.mapper.js";
import type { FileValidatorService } from "../safety/file-validator.service.js";
import type { StorageService } from "../storage/storage.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import { VaultService } from "../vault.service.js";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[],
  select: vi.fn(),
}));

vi.mock("../../../database/index.js", () => ({
  db: { select: mocks.select },
}));

vi.mock("../../../config/redis.config.js", () => ({
  getRedisConnectionOptions: () => ({}),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({ on: vi.fn(), add: vi.fn() })),
}));

function queryBuilder(result: unknown): object {
  const builder = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

function buildService(): VaultService {
  return new VaultService(
    {} as VaultCryptoService,
    {} as FileValidatorService,
    {} as StorageService,
    {} as FhirDocumentMapper,
    {} as AuditService,
    { recordForPatientAndGuardians: vi.fn(), deliverDevelopmentEmails: vi.fn() } as never
  );
}

describe("VaultService upload authorization and source derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockImplementation(() => queryBuilder(mocks.selectResults.shift()));
  });

  it("derives patient-uploaded for a patient who owns the target patient record", async () => {
    mocks.selectResults = [[{ id: "patient-record" }]];

    await expect(
      buildService().resolveUploadSource("patient-record", "patient-user", "patient")
    ).resolves.toBe("patient-uploaded");
  });

  it("denies a patient attempting to upload to another patient's record", async () => {
    mocks.selectResults = [[]];

    await expect(
      buildService().resolveUploadSource("patient-b-record", "patient-a-user", "patient")
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a guardian only when a verified, unexpired guardianship exists", async () => {
    mocks.selectResults = [[{ id: "guardianship" }]];

    await expect(
      buildService().resolveUploadSource("child-record", "guardian-user", "guardian")
    ).resolves.toBe("patient-uploaded");
  });

  it("denies a guardian with no verified guardianship", async () => {
    mocks.selectResults = [[]];

    await expect(
      buildService().resolveUploadSource("other-child-record", "guardian-user", "guardian")
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("derives facility-verified only for an active facility-patient relationship", async () => {
    mocks.selectResults = [[{ id: "relationship" }]];

    await expect(
      buildService().resolveUploadSource(
        "patient-record",
        "facility-user",
        "facility-admin",
        "facility-id"
      )
    ).resolves.toBe("facility-verified");
  });

  it("fails closed for facility roles without an active patient relationship", async () => {
    mocks.selectResults = [[]];

    await expect(
      buildService().resolveUploadSource(
        "patient-record",
        "facility-user",
        "facility-admin",
        "facility-id"
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
