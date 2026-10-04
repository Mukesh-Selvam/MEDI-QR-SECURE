import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../../audit/audit.service.js";
import type { VaultCryptoService } from "../crypto/vault-crypto.service.js";
import type { FhirDocumentMapper } from "../fhir/fhir-document.mapper.js";
import type { FileValidatorService } from "../safety/file-validator.service.js";
import type { StorageService } from "../storage/storage.service.js";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[],
  select: vi.fn(),
  transactionClient: {},
  transaction: vi.fn((callback: (transaction: object) => unknown) =>
    callback(mocks.transactionClient)
  ),
  audit: vi.fn(),
  signUrl: vi.fn(),
  getObject: vi.fn(),
  decrypt: vi.fn(),
  notificationRecords: vi.fn(),
  notificationEmail: vi.fn(),
  findActiveConsentRequestId: vi.fn(),
}));

vi.mock("../../auth/patient-access.js", () => ({
  findActiveConsentRequestId: mocks.findActiveConsentRequestId,
  hasActiveFacilityPatientRelationship: vi.fn(),
  isVerifiedGuardianOfPatient: vi.fn(),
}));

vi.mock("../../../database/index.js", () => ({
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
  },
}));

vi.mock("../../../config/redis.config.js", () => ({
  getRedisConnectionOptions: () => ({}),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    add: vi.fn(),
  })),
}));

import { VaultService } from "../vault.service.js";

const readyDocument = {
  id: "00000000-0000-0000-0000-000000000002",
  patientId: "00000000-0000-0000-0000-000000000003",
  status: "ready",
  storageBucket: "live-documents",
  storageKey: "d/opaque-key",
  mimeType: "application/pdf",
  uploadSource: "patient-uploaded",
  deletedAt: null,
};

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

function buildService(): VaultService {
  return new VaultService(
    { decrypt: mocks.decrypt } as unknown as VaultCryptoService,
    {} as FileValidatorService,
    {
      generatePresignedGetUrl: mocks.signUrl,
      getObject: mocks.getObject,
    } as unknown as StorageService,
    {} as FhirDocumentMapper,
    {
      logInTransaction: mocks.audit,
    } as unknown as AuditService,
    {
      recordForPatientAndGuardians: mocks.notificationRecords,
      deliverDevelopmentEmails: mocks.notificationEmail,
    } as never
  );
}

describe("VaultService read audit ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [[readyDocument]];
    mocks.select.mockImplementation(() => queryBuilder(mocks.selectResults.shift()));
    mocks.audit.mockResolvedValue("integrity-hash");
    mocks.notificationRecords.mockResolvedValue([]);
    mocks.notificationEmail.mockResolvedValue(undefined);
    mocks.findActiveConsentRequestId.mockResolvedValue(
      "00000000-0000-0000-0000-000000000004"
    );
    mocks.signUrl.mockResolvedValue({
      url: "https://storage.invalid/signed",
      expiresAt: new Date(Date.now() + 300_000),
    });
    mocks.getObject.mockResolvedValue(Buffer.from("ciphertext"));
    mocks.decrypt.mockResolvedValue(Buffer.from("document bytes"));
  });

  it("does not issue a presigned URL when the audit transaction fails", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("audit insert failed"));
    const service = buildService();

    await expect(
      service.generateViewUrl(
        readyDocument.id,
        "00000000-0000-0000-0000-000000000001",
        "clinician",
        "a".repeat(64)
      )
    ).rejects.toThrow("audit insert failed");

    expect(mocks.signUrl).not.toHaveBeenCalled();
    expect(mocks.notificationRecords).not.toHaveBeenCalled();
  });

  it("does not fetch or decrypt stream bytes when the audit transaction fails", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("audit insert failed"));
    const service = buildService();

    await expect(
      service.getDecryptedDocument(
        readyDocument.id,
        "00000000-0000-0000-0000-000000000001",
        "clinician",
        "a".repeat(64)
      )
    ).rejects.toThrow("audit insert failed");

    expect(mocks.getObject).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.notificationRecords).not.toHaveBeenCalled();
  });

  it("commits the audit event before signing the URL", async () => {
    const operations: string[] = [];
    mocks.audit.mockImplementation(async () => {
      operations.push("audit-committed");
    });
    mocks.signUrl.mockImplementation(async () => {
      operations.push("url-signed");
      return {
        url: "https://storage.invalid/signed",
        expiresAt: new Date(Date.now() + 300_000),
      };
    });
    const service = buildService();

    await service.generateViewUrl(
      readyDocument.id,
      "00000000-0000-0000-0000-000000000001",
      "patient",
      "a".repeat(64)
    );

    expect(operations).toEqual(["audit-committed", "url-signed"]);
  });

  it("commits the audit event before fetching and decrypting stream bytes", async () => {
    const operations: string[] = [];
    mocks.selectResults = [
      [readyDocument],
      [{
        wrappedDek: "wrapped",
        kmsKeyId: "kms-key",
        iv: "iv",
        authTag: "tag",
        sha256Plaintext: "a".repeat(64),
      }],
    ];
    mocks.audit.mockImplementation(async () => {
      operations.push("audit-committed");
    });
    mocks.getObject.mockImplementation(async () => {
      operations.push("ciphertext-fetched");
      return Buffer.from("ciphertext");
    });
    mocks.decrypt.mockImplementation(async () => {
      operations.push("plaintext-decrypted");
      return Buffer.from("document bytes");
    });
    const service = buildService();

    await service.getDecryptedDocument(
      readyDocument.id,
      "00000000-0000-0000-0000-000000000001",
      "patient",
      "a".repeat(64)
    );

    expect(operations).toEqual([
      "audit-committed",
      "ciphertext-fetched",
      "plaintext-decrypted",
    ]);
  });

  it("records clinician read notifications in the audit transaction before either output", async () => {
    const operations: string[] = [];
    mocks.selectResults = [
      [readyDocument],
      [readyDocument],
      [{
        wrappedDek: "wrapped",
        kmsKeyId: "kms-key",
        iv: "iv",
        authTag: "tag",
        sha256Plaintext: "a".repeat(64),
      }],
    ];
    mocks.audit.mockImplementation(async () => {
      operations.push("audit-written");
      return "integrity-hash";
    });
    mocks.notificationRecords.mockImplementation(async () => {
      operations.push("notification-recorded");
      return [];
    });
    mocks.signUrl.mockImplementation(async () => {
      operations.push("url-signed");
      return {
        url: "https://storage.invalid/signed",
        expiresAt: new Date(Date.now() + 300_000),
      };
    });
    mocks.getObject.mockImplementation(async () => {
      operations.push("ciphertext-fetched");
      return Buffer.from("ciphertext");
    });
    const service = buildService();

    await service.generateViewUrl(
      readyDocument.id,
      "00000000-0000-0000-0000-000000000001",
      "clinician",
      "a".repeat(64)
    );
    expect(operations).toEqual([
      "audit-written",
      "notification-recorded",
      "url-signed",
    ]);

    operations.length = 0;
    mocks.decrypt.mockImplementation(async () => {
      operations.push("plaintext-decrypted");
      return Buffer.from("document bytes");
    });
    await service.getDecryptedDocument(
      readyDocument.id,
      "00000000-0000-0000-0000-000000000001",
      "clinician",
      "a".repeat(64)
    );
    expect(operations).toEqual([
      "audit-written",
      "notification-recorded",
      "ciphertext-fetched",
      "plaintext-decrypted",
    ]);
    expect(mocks.notificationRecords).toHaveBeenCalledWith(
      readyDocument.patientId,
      "DOCUMENT_READ",
      "00000000-0000-0000-0000-000000000004",
      expect.any(Object)
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DOCUMENT_VIEWED" }),
      mocks.transactionClient
    );
  });

  it("refuses to audit or read a document that is not ready", async () => {
    mocks.selectResults = [[{ ...readyDocument, status: "quarantined" }]];
    const service = buildService();

    await expect(
      service.getDecryptedDocument(
        readyDocument.id,
        "00000000-0000-0000-0000-000000000001",
        "patient",
        "a".repeat(64)
      )
    ).rejects.toThrow(/not available for viewing/);

    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("rejects a content type outside the server-supported fixed set", async () => {
    mocks.selectResults = [[{ ...readyDocument, mimeType: "text/html" }]];
    const service = buildService();

    await expect(
      service.getDecryptedDocument(
        readyDocument.id,
        "00000000-0000-0000-0000-000000000001",
        "patient",
        "a".repeat(64)
      )
    ).rejects.toThrow(/content type is not supported/);

    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
});
