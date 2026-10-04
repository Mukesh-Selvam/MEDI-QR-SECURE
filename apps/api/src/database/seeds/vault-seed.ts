/**
 * Vault Seed — Clearly Fake Sample Documents
 * ===========================================
 * Creates sample documents for dev/testing purposes.
 * ALL patient identifiers, names, and clinical content are FAKE.
 * Health IDs, phone numbers, and real patient data are NEVER used here.
 *
 * Run: pnpm --filter @mediqr/api exec tsx src/database/seeds/vault-seed.ts
 */

import "../../config/env.js";
import { db } from "../index.js";
import {
  users,
  patients,
  documents,
  documentCryptoKeys,
  fhirDocumentReferences,
} from "../schema.js";
import { VaultCryptoService } from "../../modules/vault/crypto/vault-crypto.service.js";
import { LocalKmsAdapter } from "../../modules/vault/kms/local-kms.adapter.js";
import { FhirDocumentMapper } from "../../modules/vault/fhir/fhir-document.mapper.js";
import { randomUUID } from "crypto";

// Build crypto services
const kms = new LocalKmsAdapter();
kms.onModuleInit();
const crypto = new VaultCryptoService(kms);
const fhirMapper = new FhirDocumentMapper();

// Fake PDF content (not a real document — clearly labelled)
const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog >>\n" +
  "% FAKE SEED DOCUMENT — NOT REAL CLINICAL DATA\n" +
  "% This is a test document generated for MediQR development.\n" +
  "endobj\n%%EOF\n"
);

const SAMPLE_DOCS = [
  {
    type: "lab" as const,
    source: "facility-verified" as const,
    notes: "FAKE: Complete Blood Count report — development seed only",
    date: new Date("2026-01-15"),
  },
  {
    type: "prescription" as const,
    source: "facility-verified" as const,
    notes: "FAKE: Amoxicillin 500mg prescription — development seed only",
    date: new Date("2026-02-20"),
  },
  {
    type: "vaccination" as const,
    source: "patient-uploaded" as const,
    notes: "FAKE: COVID-19 vaccination record (Dose 2) — development seed only",
    date: new Date("2025-11-10"),
  },
  {
    type: "scan" as const,
    source: "facility-verified" as const,
    notes: "FAKE: Chest X-Ray — development seed only",
    date: new Date("2026-03-05"),
  },
  {
    type: "discharge" as const,
    source: "facility-verified" as const,
    notes: "FAKE: Post-operative discharge summary — development seed only",
    date: new Date("2026-03-08"),
  },
];

async function seedVault() {
  console.info("[VaultSeed] Starting vault seed with FAKE sample documents...");

  // Create a fake seed user + patient if none exist
  const seedUserId = randomUUID();
  const seedPatientId = randomUUID();

  const existingUsers = await db.select().from(users).limit(1);
  let uploaderId: string;
  let patientId: string;

  if (existingUsers.length === 0) {
    // Create minimal seed user
    const [seedUser] = await db.insert(users).values({
      id: seedUserId,
      role: "patient",
      status: "active",
    }).returning();

    const [seedPatient] = await db.insert(patients).values({
      id: seedPatientId,
      userId: seedUser.id,
      healthId: `SEED-FAKE-${Date.now()}`,
      fullName: "FAKE SEED PATIENT — NOT REAL",
      phoneHash: "0".repeat(64),
      encryptedPhone: "SEED_ENCRYPTED_PLACEHOLDER",
    }).returning();

    uploaderId = seedUser.id;
    patientId = seedPatient.id;
    console.info("[VaultSeed] Created fake seed patient.");
  } else {
    // Use the first existing user
    const [firstUser] = existingUsers;
    uploaderId = firstUser.id;
    const existingPatients = await db.select().from(patients).limit(1);
    if (existingPatients.length === 0) {
      const [seedPatient] = await db.insert(patients).values({
        id: seedPatientId,
        userId: firstUser.id,
        healthId: `SEED-FAKE-${Date.now()}`,
        fullName: "FAKE SEED PATIENT — NOT REAL",
        phoneHash: "0".repeat(64),
        encryptedPhone: "SEED_ENCRYPTED_PLACEHOLDER",
      }).returning();
      patientId = seedPatient.id;
    } else {
      patientId = existingPatients[0].id;
    }
  }

  for (const sample of SAMPLE_DOCS) {
    // Encrypt the fake document
    const encrypted = await crypto.encrypt(FAKE_PDF);
    const storageKey = `seed/${randomUUID()}`;

    const [doc] = await db.insert(documents).values({
      patientId,
      uploaderId,
      uploadSource: sample.source,
      documentType: sample.type,
      storageKey,
      storageBucket: "mediqr-documents",
      mimeType: "application/pdf",
      fileSizeBytes: FAKE_PDF.length,
      status: "ready", // Seed docs are already "ready" (skip scanning in dev seed)
      scanStatus: "clean",
      scanCompletedAt: new Date(),
      documentDate: sample.date,
      notes: sample.notes,
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

    const { fhirId, resource } = fhirMapper.map(doc, encrypted.sha256Plaintext);
    await db.insert(fhirDocumentReferences).values({
      documentId: doc.id,
      fhirId,
      resource,
    });

    console.info(`[VaultSeed] Created FAKE ${sample.type} document.`);
  }

  console.info("[VaultSeed] Seed complete. All documents are clearly fake and labelled.");
  process.exit(0);
}

seedVault().catch((err) => {
  console.error("[VaultSeed] Failed:", err);
  process.exit(1);
});
