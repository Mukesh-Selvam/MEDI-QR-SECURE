/**
 * VaultModule
 * ===========
 * Wires together all Records Vault services:
 *   - LocalKmsAdapter (dev) / swap for cloud KMS in production
 *   - VaultCryptoService (envelope encryption)
 *   - FileValidatorService (magic byte detection + metadata stripping)
 *   - StorageService (MinIO/S3 wrapper)
 *   - ClamAvScannerService (TCP INSTREAM antivirus)
 *   - DocumentScanWorker (BullMQ async scan pipeline)
 *   - FhirDocumentMapper (HL7 FHIR R4 resource mapping)
 *   - VaultService (orchestrator)
 *   - VaultController (REST endpoints)
 */

import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { LocalKmsAdapter } from "./kms/local-kms.adapter.js";
import { KMS_ADAPTER_TOKEN, VaultCryptoService } from "./crypto/vault-crypto.service.js";
import { FileValidatorService } from "./safety/file-validator.service.js";
import { StorageService } from "./storage/storage.service.js";
import { ClamAvScannerService } from "./scanner/clamav-scanner.service.js";
import { DocumentScanWorker } from "./scanner/document-scan.worker.js";
import { FhirDocumentMapper } from "./fhir/fhir-document.mapper.js";
import { VaultService } from "./vault.service.js";
import { VaultController } from "./vault.controller.js";

@Module({
  imports: [AuditModule],
  controllers: [VaultController],
  providers: [
    // KMS adapter — dev: LocalKmsAdapter, prod: swap to AwsKmsAdapter etc.
    LocalKmsAdapter,
    {
      provide: KMS_ADAPTER_TOKEN,
      useExisting: LocalKmsAdapter,
    },
    VaultCryptoService,
    FileValidatorService,
    StorageService,
    ClamAvScannerService,
    DocumentScanWorker,
    FhirDocumentMapper,
    VaultService,
  ],
  exports: [VaultService, StorageService, VaultCryptoService],
})
export class VaultModule {}
