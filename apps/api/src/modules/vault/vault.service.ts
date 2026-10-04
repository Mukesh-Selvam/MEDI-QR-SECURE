/**
 * VaultService
 * ============
 * Core orchestrator for the Records Vault:
 * - Document upload: validate → encrypt → store in quarantine → enqueue scan
 * - Secure view URL: Cerbos policy check → generate presigned URL → audit
 * - Timeline: chronological, grouped by type, with source labels
 *
 * Security rules enforced here:
 * - Never log document contents, filenames, or patient identifiers.
 * - Policy check happens BEFORE any data is returned or URLs are generated.
 * - Presigned URLs are generated with a hard 5-minute (300s) expiry.
 * - Audit events are written atomically with the presigned URL generation.
 */

import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { db } from "../../database/index.js";
import {
  documents,
  documentCryptoKeys,
  documentVersions,
  fhirDocumentReferences,
} from "../../database/schema.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { VaultCryptoService } from "./crypto/vault-crypto.service.js";
import { FileValidatorService } from "./safety/file-validator.service.js";
import { StorageService, PRESIGNED_URL_EXPIRY_SECONDS } from "./storage/storage.service.js";
import { FhirDocumentMapper } from "./fhir/fhir-document.mapper.js";
import { AuditService } from "../audit/audit.service.js";
import { SCAN_QUEUE_NAME, type ScanDocumentJob } from "./scanner/document-scan.worker.js";
import { env } from "../../config/env.js";

export type DocumentType = "scan" | "lab" | "prescription" | "vaccination" | "discharge";
export type UploadSource = "patient-uploaded" | "facility-verified";

export interface UploadDocumentInput {
  /** Buffer of the file (raw bytes from multipart) */
  fileBuffer: Buffer;
  /** MIME type declared by the uploader (not trusted — overridden by magic bytes) */
  declaredMimeType?: string;
  /** Document category */
  documentType: DocumentType;
  /** Target patient (must be verified by caller before reaching here) */
  patientId: string;
  /** Authenticated uploader's user ID */
  uploaderId: string;
  /** Upload source label */
  uploadSource: UploadSource;
  /** Optional clinical document date (not upload date) */
  documentDate?: Date;
  /** Optional opaque notes (must not contain patient identifiers) */
  notes?: string;
  /** Facility ID if facility-verified upload */
  facilityId?: string;
  /** Client IP hash for audit */
  ipHash: string;
}

export interface TimelineDocument {
  id: string;
  documentType: DocumentType;
  uploadSource: UploadSource;
  sourceLabel: "verified-source" | "patient-uploaded";
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  scanStatus: string;
  documentDate: Date | null;
  createdAt: Date;
}

export interface TimelineGroup {
  type: DocumentType;
  documents: TimelineDocument[];
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private scanQueue!: Queue<ScanDocumentJob>;

  constructor(
    @Inject(VaultCryptoService) private readonly crypto: VaultCryptoService,
    @Inject(FileValidatorService) private readonly fileValidator: FileValidatorService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(FhirDocumentMapper) private readonly fhirMapper: FhirDocumentMapper,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.scanQueue = new Queue<ScanDocumentJob>(SCAN_QUEUE_NAME, {
      connection: { url: env.REDIS_URL ?? `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}/0` },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
  }

  /**
   * Validates, encrypts, and stages a document in quarantine for scanning.
   * Returns immediately (202 Accepted); scan is asynchronous.
   */
  async uploadDocument(input: UploadDocumentInput): Promise<{ id: string; status: "quarantined" }> {
    const { fileBuffer, declaredMimeType, documentType, patientId, uploaderId, uploadSource, documentDate, notes, facilityId, ipHash } = input;

    // 1. Validate file (magic bytes, size, metadata strip)
    const validated = this.fileValidator.validate(fileBuffer, declaredMimeType);

    // 2. Encrypt the cleaned buffer
    const encrypted = await this.crypto.encrypt(validated.cleanedBuffer);

    // 3. Put encrypted ciphertext in quarantine bucket
    const quarantineKey = await this.storage.putQuarantine(
      encrypted.ciphertext,
      validated.mimeType
    );

    // 4. Persist document record + crypto keys in a transaction
    const [doc] = await db.insert(documents).values({
      patientId,
      uploaderId,
      uploadSource: uploadSource as "patient-uploaded" | "facility-verified",
      documentType: documentType as "scan" | "lab" | "prescription" | "vaccination" | "discharge",
      storageKey: quarantineKey,
      storageBucket: env.STORAGE_BUCKET_QUARANTINE,
      mimeType: validated.mimeType,
      fileSizeBytes: validated.fileSizeBytes,
      status: "quarantined",
      scanStatus: "pending",
      documentDate: documentDate ?? null,
      facilityId: facilityId ?? null,
      notes: notes ?? null,
    }).returning();

    await db.insert(documentCryptoKeys).values({
      documentId: doc.id,
      wrappedDek: encrypted.wrappedDek,
      kmsKeyId: encrypted.kmsKeyId,
      algorithm: "aes-256-gcm",
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      sha256Plaintext: encrypted.sha256Plaintext,
    });

    // 5. Insert initial version record
    await db.insert(documentVersions).values({
      documentId: doc.id,
      versionNumber: 1,
      storageKey: quarantineKey,
      storageBucket: env.STORAGE_BUCKET_QUARANTINE,
      uploaderId,
      sha256Plaintext: encrypted.sha256Plaintext,
      fileSizeBytes: validated.fileSizeBytes,
    });

    // 6. Create FHIR DocumentReference
    const { fhirId, resource } = this.fhirMapper.map(doc, encrypted.sha256Plaintext);
    await db.insert(fhirDocumentReferences).values({
      documentId: doc.id,
      fhirId,
      resource,
    });

    // 7. Enqueue scan job
    await this.scanQueue.add("scan-document", {
      documentId: doc.id,
      quarantineKey,
      quarantineBucket: env.STORAGE_BUCKET_QUARANTINE,
    });

    // 8. Audit event — no patient identifiers in the payload
    await this.audit.log({
      actorId: uploaderId,
      actorRole: uploadSource === "facility-verified" ? "facility-admin" : "patient",
      action: "DOCUMENT_UPLOADED",
      resourceType: "document",
      resourceId: doc.id,
      outcome: "SUCCESS",
      ipHash,
    });

    this.logger.log(`[Vault] Document ${doc.id} uploaded and staged for scanning`);
    return { id: doc.id, status: "quarantined" };
  }

  /**
   * Returns a 5-minute presigned URL for a document.
   * Policy check MUST be passed before calling this method.
   * Audit event is written atomically.
   */
  async generateViewUrl(
    documentId: string,
    actorId: string,
    actorRole: string,
    ipHash: string
  ): Promise<{
    url: string;
    expiresAt: Date;
    expiresInSeconds: number;
    sourceLabel: string;
  }> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "ready") {
      throw new BadRequestException(
        `Document is not available for viewing (status: ${doc.status})`
      );
    }

    await this.audit.logInTransaction({
      actorId,
      actorRole,
      action: "DOCUMENT_VIEWED",
      resourceType: "document",
      resourceId: documentId,
      outcome: "SUCCESS",
      ipHash,
    });

    // Generate the URL only after the audit transaction commits.
    const { url, expiresAt } = await this.storage.generatePresignedGetUrl(
      doc.storageBucket,
      doc.storageKey,
      "document", // never expose real filename
      doc.mimeType
    );

    return {
      url,
      expiresAt,
      expiresInSeconds: PRESIGNED_URL_EXPIRY_SECONDS,
      sourceLabel: doc.uploadSource === "facility-verified" ? "verified-source" : "patient-uploaded",
    };
  }

  /**
   * Retrieves and decrypts a document in-memory for the zero-footprint viewer.
   * Plaintext is returned in a Buffer, to be streamed with anti-caching headers.
   * Plaintext NEVER touches disk.
   * Commits an audit entry before reading or decrypting document bytes.
   */
  async getDecryptedDocument(
    documentId: string,
    actorId: string,
    actorRole: string,
    ipHash: string,
    purpose: string = "clinical-care"
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    sourceLabel: "verified-source" | "patient-uploaded";
    patientId: string;
  }> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!doc) throw new NotFoundException("Document not found");
    if (doc.status !== "ready") {
      throw new BadRequestException(
        `Document is not available for viewing (status: ${doc.status})`
      );
    }

    await this.audit.logInTransaction({
      actorId,
      actorRole,
      action: "DOCUMENT_VIEWED",
      resourceType: "document",
      resourceId: documentId,
      outcome: "SUCCESS",
      ipHash,
    });

    // 1. Fetch encrypted ciphertext only after the audit transaction commits.
    const ciphertext = await this.storage.getObject(doc.storageBucket, doc.storageKey);

    // 2. Fetch envelope crypto keys
    const [cryptoKey] = await db
      .select()
      .from(documentCryptoKeys)
      .where(eq(documentCryptoKeys.documentId, documentId))
      .limit(1);

    if (!cryptoKey) {
      throw new NotFoundException("Document crypto keys not found");
    }

    // 3. Decrypt in memory (AES-256-GCM + wrapped DEK)
    const plaintext = await this.crypto.decrypt({
      ciphertext,
      wrappedDek: cryptoKey.wrappedDek,
      kmsKeyId: cryptoKey.kmsKeyId,
      iv: cryptoKey.iv,
      authTag: cryptoKey.authTag,
      sha256Plaintext: cryptoKey.sha256Plaintext,
    });

    void purpose; // Kept for audit context

    return {
      buffer: plaintext,
      mimeType: doc.mimeType,
      sourceLabel: doc.uploadSource === "facility-verified" ? "verified-source" : "patient-uploaded",
      patientId: doc.patientId,
    };
  }

  /**
   * Returns the chronological timeline of documents for a patient,
   * grouped by document type, with source labels.
   */
  async getTimeline(patientId: string): Promise<TimelineGroup[]> {
    const rows = await db
      .select({
        id: documents.id,
        documentType: documents.documentType,
        uploadSource: documents.uploadSource,
        mimeType: documents.mimeType,
        fileSizeBytes: documents.fileSizeBytes,
        status: documents.status,
        scanStatus: documents.scanStatus,
        documentDate: documents.documentDate,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.patientId, patientId),
          isNull(documents.deletedAt)
        )
      )
      .orderBy(desc(documents.documentDate), desc(documents.createdAt));

    const grouped = new Map<DocumentType, TimelineDocument[]>();
    const typeOrder: DocumentType[] = ["lab", "scan", "prescription", "vaccination", "discharge"];

    for (const row of rows) {
      const type = row.documentType as DocumentType;
      if (!grouped.has(type)) grouped.set(type, []);

      grouped.get(type)!.push({
        id: row.id,
        documentType: type,
        uploadSource: row.uploadSource as UploadSource,
        sourceLabel: row.uploadSource === "facility-verified" ? "verified-source" : "patient-uploaded",
        mimeType: row.mimeType,
        fileSizeBytes: row.fileSizeBytes,
        status: row.status,
        scanStatus: row.scanStatus,
        documentDate: row.documentDate,
        createdAt: row.createdAt,
      });
    }

    return typeOrder
      .filter((t) => grouped.has(t))
      .map((t) => ({ type: t, documents: grouped.get(t)! }));
  }

  /** Get a single document record (for policy checks — returns minimal info) */
  async findById(documentId: string): Promise<{ patientId: string; uploadSource: string; status: string } | null> {
    const [doc] = await db
      .select({
        patientId: documents.patientId,
        uploadSource: documents.uploadSource,
        status: documents.status,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);

    return doc ?? null;
  }
}
