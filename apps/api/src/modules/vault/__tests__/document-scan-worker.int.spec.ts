import { randomUUID } from "crypto";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Queue, QueueEvents } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cryptoKey: undefined as Record<string, unknown> | undefined,
  documentState: {} as Record<string, unknown>,
  fhirResource: undefined as Record<string, unknown> | undefined,
  select: vi.fn(),
  update: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("../../../database/index.js", () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

import { env } from "../../../config/env.js";
import { getRedisConnectionOptions } from "../../../config/redis.config.js";
import {
  documentCryptoKeys,
  documents,
  fhirDocumentReferences,
  type Document,
} from "../../../database/schema.js";
import type { AuditService } from "../../audit/audit.service.js";
import { FhirDocumentMapper } from "../fhir/fhir-document.mapper.js";
import type { VaultCryptoService } from "../crypto/vault-crypto.service.js";
import { ClamAvScannerService } from "../scanner/clamav-scanner.service.js";
import {
  DocumentScanWorker,
  SCAN_QUEUE_NAME,
  type ScanDocumentJob,
} from "../scanner/document-scan.worker.js";
import { StorageService } from "../storage/storage.service.js";

const EICAR = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii"
);
const CLEAN_PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.alloc(1024, 0x41),
]);
const INFECTED_PAYLOAD = Buffer.from(EICAR);

describe("DocumentScanWorker (integration)", () => {
  let storage: StorageService;
  let scanner: ClamAvScannerService;
  let scanWorker: DocumentScanWorker | undefined;
  let queueName: string;
  let queue: Queue<ScanDocumentJob>;
  let queueEvents: QueueEvents;
  let bucketClient: S3Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.cryptoKey = {
      wrappedDek: "wrapped-test-dek",
      kmsKeyId: "test-key",
      iv: "test-iv",
      authTag: "test-auth-tag",
      sha256Plaintext: "test-hash",
    };
    mocks.documentState = {
      status: "quarantined",
      scanStatus: "pending",
    };
    mocks.fhirResource = new FhirDocumentMapper().map(
      createDocument(),
      "ab".repeat(32)
    ).resource as unknown as Record<string, unknown>;
    mocks.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === documentCryptoKeys
              ? [mocks.cryptoKey]
              : [{ resource: mocks.fhirResource }],
        }),
      }),
    }));
    mocks.update.mockImplementation((table: unknown) => ({
      set: (changes: Record<string, unknown>) => ({
        where: async () => {
          if (table === documents) {
            Object.assign(mocks.documentState, changes);
          } else if (table === fhirDocumentReferences) {
            mocks.fhirResource = changes["resource"] as Record<string, unknown>;
          }
        },
      }),
    }));

    bucketClient = new S3Client({
      endpoint: `http${env.STORAGE_USE_SSL ? "s" : ""}://${env.STORAGE_ENDPOINT}:${env.STORAGE_PORT}`,
      region: env.STORAGE_REGION,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
      forcePathStyle: true,
    });
    await ensureBucket(bucketClient, env.STORAGE_BUCKET_QUARANTINE);
    await ensureBucket(bucketClient, env.STORAGE_BUCKET_DOCUMENTS);

    storage = new StorageService();
    storage.onModuleInit();
    scanner = new ClamAvScannerService();
    queueName = `${SCAN_QUEUE_NAME}-${randomUUID()}`;
    queue = new Queue<ScanDocumentJob>(queueName, {
      connection: getRedisConnectionOptions(),
    });
    queueEvents = new QueueEvents(queueName, {
      connection: getRedisConnectionOptions(),
    });
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady()]);
  });

  afterEach(async () => {
    await scanWorker?.onModuleDestroy();
    await queueEvents?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    bucketClient?.destroy();
  });

  it("promotes a clean file to the live bucket and marks it ready", async () => {
    const encryptedPayload = Buffer.from("encrypted-clean-payload");
    const quarantineKey = await storage.putQuarantine(
      encryptedPayload,
      "application/pdf"
    );
    const crypto = {
      decrypt: vi.fn().mockResolvedValue(Buffer.from(CLEAN_PDF)),
    } as unknown as VaultCryptoService;
    const audit = { log: mocks.auditLog } as unknown as AuditService;
    const promote = vi.spyOn(storage, "promoteToLive");
    scanWorker = new DocumentScanWorker(crypto, storage, scanner, audit);
    await scanWorker.start(queueName);

    await enqueueAndWait(queue, queueEvents, {
      documentId: randomUUID(),
      quarantineKey,
      quarantineBucket: env.STORAGE_BUCKET_QUARANTINE,
    });

    expect(mocks.documentState).toMatchObject({
      status: "ready",
      scanStatus: "clean",
    });
    expect(mocks.fhirResource).toMatchObject({
      status: "current",
      docStatus: "final",
    });
    expect(promote).toHaveBeenCalledOnce();
    const liveKey = mocks.documentState["storageKey"];
    expect(liveKey).toEqual(expect.any(String));
    await expect(
      storage.getObject(env.STORAGE_BUCKET_DOCUMENTS, liveKey as string)
    ).resolves.toEqual(encryptedPayload);
    await expect(
      storage.getObject(env.STORAGE_BUCKET_QUARANTINE, quarantineKey)
    ).rejects.toThrow();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SCAN_SUCCESS" })
    );
  }, 45000);

  it("keeps an infected file quarantined and never promotes it to the live bucket", async () => {
    const encryptedPayload = Buffer.from("encrypted-infected-payload");
    const quarantineKey = await storage.putQuarantine(
      encryptedPayload,
      "application/pdf"
    );
    const crypto = {
      decrypt: vi.fn().mockResolvedValue(Buffer.from(INFECTED_PAYLOAD)),
    } as unknown as VaultCryptoService;
    const audit = { log: mocks.auditLog } as unknown as AuditService;
    const promote = vi.spyOn(storage, "promoteToLive");
    scanWorker = new DocumentScanWorker(crypto, storage, scanner, audit);
    await scanWorker.start(queueName);

    await enqueueAndWait(queue, queueEvents, {
      documentId: randomUUID(),
      quarantineKey,
      quarantineBucket: env.STORAGE_BUCKET_QUARANTINE,
    });

    expect(mocks.documentState).toMatchObject({
      status: "quarantined",
      scanStatus: "infected",
    });
    expect(mocks.fhirResource).toMatchObject({
      status: "entered-in-error",
      docStatus: "entered-in-error",
    });
    expect(promote).not.toHaveBeenCalled();
    await expect(
      storage.getObject(env.STORAGE_BUCKET_QUARANTINE, quarantineKey)
    ).resolves.toEqual(encryptedPayload);
    await expect(
      storage.getObject(env.STORAGE_BUCKET_DOCUMENTS, quarantineKey)
    ).rejects.toThrow();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SCAN_ALERT_INFECTED" })
    );
  }, 45000);

  it("fails closed when the scanner errors, leaving the file quarantined", async () => {
    const encryptedPayload = Buffer.from("encrypted-unscanned-payload");
    const quarantineKey = await storage.putQuarantine(
      encryptedPayload,
      "application/pdf"
    );
    const crypto = {
      decrypt: vi.fn().mockResolvedValue(Buffer.from(CLEAN_PDF)),
    } as unknown as VaultCryptoService;
    const failingScanner = {
      scan: vi.fn().mockRejectedValue(new Error("scanner unavailable")),
    } as unknown as ClamAvScannerService;
    const audit = { log: mocks.auditLog } as unknown as AuditService;
    const promote = vi.spyOn(storage, "promoteToLive");
    scanWorker = new DocumentScanWorker(crypto, storage, failingScanner, audit);
    await scanWorker.start(queueName);

    await enqueueAndWait(queue, queueEvents, {
      documentId: randomUUID(),
      quarantineKey,
      quarantineBucket: env.STORAGE_BUCKET_QUARANTINE,
    });

    expect(mocks.documentState).toMatchObject({
      status: "quarantined",
      scanStatus: "scan_failed",
    });
    expect(mocks.fhirResource).toMatchObject({
      status: "entered-in-error",
      docStatus: "entered-in-error",
    });
    expect(promote).not.toHaveBeenCalled();
    await expect(
      storage.getObject(env.STORAGE_BUCKET_QUARANTINE, quarantineKey)
    ).resolves.toEqual(encryptedPayload);
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SCAN_FAILED" })
    );
  }, 45000);
});

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      !(error instanceof S3ServiceException) ||
      error.$metadata.httpStatusCode !== 404
    ) {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function enqueueAndWait(
  queue: Queue<ScanDocumentJob>,
  events: QueueEvents,
  data: ScanDocumentJob
): Promise<void> {
  const job = await queue.add("scan-document", data, {
    jobId: randomUUID(),
    removeOnComplete: true,
    removeOnFail: true,
  });
  await job.waitUntilFinished(events, 40000);
}

function createDocument(): Document {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: randomUUID(),
    patientId: randomUUID(),
    uploaderId: randomUUID(),
    uploadSource: "patient-uploaded",
    documentType: "lab",
    storageKey: "q/test",
    storageBucket: env.STORAGE_BUCKET_QUARANTINE,
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    status: "quarantined",
    scanStatus: "pending",
    scanCompletedAt: null,
    scanThreatName: null,
    documentDate: null,
    facilityId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
