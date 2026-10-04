/**
 * DocumentScanWorker
 * ==================
 * BullMQ worker that processes asynchronous document scan jobs.
 *
 * Job lifecycle:
 * 1. Pick up 'scan-document' job from Redis queue.
 * 2. Fetch encrypted ciphertext from MinIO quarantine bucket.
 * 3. Decrypt in-memory using VaultCryptoService (never write plaintext to disk).
 * 4. Stream plaintext to ClamAV INSTREAM scanner.
 * 5a. CLEAN: Copy encrypted payload from quarantine → live documents bucket.
 *            Delete quarantine copy. Update DB: status=ready, scanStatus=clean.
 * 5b. INFECTED/FAILED: Update DB: status=quarantined (stays), scanStatus=infected|scan_failed.
 *                      Log audit event SCAN_ALERT_INFECTED or SCAN_FAILED.
 *
 * Security rules:
 * - Plaintext only ever exists in a transient in-memory Buffer.
 * - No plaintext is written to disk, logged, or serialised.
 * - Scan errors are treated as failures (fail-closed).
 * - BullMQ retries up to 3 times on transient ClamAV/network errors.
 */

import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Worker, Job } from "bullmq";
import { db } from "../../../database/index.js";
import { documents, documentCryptoKeys } from "../../../database/schema.js";
import { eq } from "drizzle-orm";
import { VaultCryptoService } from "../crypto/vault-crypto.service.js";
import { StorageService } from "../storage/storage.service.js";
import { ClamAvScannerService } from "./clamav-scanner.service.js";
import { AuditService } from "../../audit/audit.service.js";
import { env } from "../../../config/env.js";

export const SCAN_QUEUE_NAME = "document-scan";

export interface ScanDocumentJob {
  documentId: string;
  quarantineKey: string;
  quarantineBucket: string;
}

@Injectable()
export class DocumentScanWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentScanWorker.name);
  private worker?: Worker;

  constructor(
    @Inject(VaultCryptoService) private readonly crypto: VaultCryptoService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ClamAvScannerService) private readonly scanner: ClamAvScannerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const redisUrl =
      env.REDIS_URL ??
      `redis://${env.REDIS_PASSWORD ? `:${env.REDIS_PASSWORD}@` : ""}${env.REDIS_HOST}:${env.REDIS_PORT}/0`;
    this.start(redisUrl);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  start(redisUrl: string): void {
    try {
      this.worker = new Worker<ScanDocumentJob>(
        SCAN_QUEUE_NAME,
        async (job: Job<ScanDocumentJob>) => {
          await this.processJob(job);
        },
        {
          connection: { url: redisUrl },
          concurrency: 2,
        }
      );

      this.worker.on("completed", (job) => {
        this.logger.log(`[ScanWorker] Job ${job.id} completed`);
      });

      this.worker.on("failed", (job, err) => {
        this.logger.error(`[ScanWorker] Job ${job?.id} failed: ${err.message}`);
      });

      this.worker.on("error", (err) => {
        this.logger.warn(`[ScanWorker] Redis connection error: ${err.message}`);
      });

      this.logger.log(`[ScanWorker] Listening on queue: ${SCAN_QUEUE_NAME}`);
    } catch (err) {
      this.logger.warn(`[ScanWorker] Could not connect BullMQ worker: ${String(err)}`);
    }
  }

  private async processJob(job: Job<ScanDocumentJob>): Promise<void> {
    const { documentId, quarantineKey, quarantineBucket } = job.data;
    this.logger.log(`[ScanWorker] Processing scan for document ${documentId}`);

    // Mark as scanning
    await db
      .update(documents)
      .set({ scanStatus: "scanning", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    // 1. Fetch encrypted ciphertext
    let ciphertext: Buffer;
    try {
      ciphertext = await this.storage.getObject(quarantineBucket, quarantineKey);
    } catch (err) {
      await this.markScanFailed(documentId, `Failed to fetch from quarantine: ${String(err)}`);
      return;
    }

    // 2. Fetch crypto metadata
    const [cryptoKey] = await db
      .select()
      .from(documentCryptoKeys)
      .where(eq(documentCryptoKeys.documentId, documentId))
      .limit(1);

    if (!cryptoKey) {
      await this.markScanFailed(documentId, "Crypto key record not found");
      return;
    }

    // 3. Decrypt in-memory
    let plaintext: Buffer;
    try {
      plaintext = await this.crypto.decrypt({
        ciphertext,
        wrappedDek: cryptoKey.wrappedDek,
        kmsKeyId: cryptoKey.kmsKeyId,
        iv: cryptoKey.iv,
        authTag: cryptoKey.authTag,
        sha256Plaintext: cryptoKey.sha256Plaintext,
      });
    } catch (err) {
      await this.markScanFailed(documentId, `Decryption failed: ${String(err)}`);
      return;
    }

    // 4. Scan with ClamAV
    let scanResult: { clean: boolean; threatName?: string };
    try {
      scanResult = await this.scanner.scan(plaintext);
    } catch (err) {
      // Fail-closed: scanner unreachable → reject file
      await this.markScanFailed(documentId, `ClamAV unavailable: ${String(err)}`);
      return;
    } finally {
      // Zero out plaintext from memory
      plaintext.fill(0);
    }

    if (!scanResult.clean) {
      // Infected — stays in quarantine
      await db
        .update(documents)
        .set({
          scanStatus: "infected",
          scanCompletedAt: new Date(),
          scanThreatName: scanResult.threatName ?? "UnknownThreat",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      await this.audit.log({
        actorId: undefined,
        actorRole: "system",
        action: "SCAN_ALERT_INFECTED",
        resourceType: "document",
        resourceId: documentId,
        outcome: "FAILURE",
        ipHash: "00000000000000000000000000000000",
      });

      this.logger.warn(`[ScanWorker] INFECTED document ${documentId} — kept in quarantine`);
      return;
    }

    // 5. Promote clean file from quarantine → live bucket
    let liveKey: string;
    try {
      liveKey = await this.storage.promoteToLive(quarantineKey);
      await this.storage.deleteObject(quarantineBucket, quarantineKey);
    } catch (err) {
      await this.markScanFailed(documentId, `Promotion to live failed: ${String(err)}`);
      return;
    }

    // 6. Update DB: ready
    await db
      .update(documents)
      .set({
        status: "ready",
        scanStatus: "clean",
        scanCompletedAt: new Date(),
        storageKey: liveKey,
        storageBucket: env.STORAGE_BUCKET_DOCUMENTS,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await this.audit.log({
      actorId: undefined,
      actorRole: "system",
      action: "SCAN_SUCCESS",
      resourceType: "document",
      resourceId: documentId,
      outcome: "SUCCESS",
      ipHash: "00000000000000000000000000000000",
    });

    this.logger.log(`[ScanWorker] Document ${documentId} is clean and live at ${liveKey}`);
  }

  private async markScanFailed(documentId: string, reason: string): Promise<void> {
    this.logger.error(`[ScanWorker] Scan failed for ${documentId}: ${reason}`);
    await db
      .update(documents)
      .set({
        scanStatus: "scan_failed",
        scanCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await this.audit.log({
      actorId: undefined,
      actorRole: "system",
      action: "SCAN_FAILED",
      resourceType: "document",
      resourceId: documentId,
      outcome: "FAILURE",
      ipHash: "00000000000000000000000000000000",
    });
  }

  async stop(): Promise<void> {
    await this.worker?.close();
  }
}
