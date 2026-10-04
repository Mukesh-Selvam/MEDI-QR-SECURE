/**
 * MediQR Identity, Access & Audit Database Schema (Drizzle ORM)
 * ============================================================
 * Zero-leak design:
 * - Patient PII (phone number) is encrypted with AES-256-GCM.
 * - Phone lookup uses HMAC-SHA256 blind index (phone_hash).
 * - Audit logs store strictly opaque UUIDs, never plaintext patient/clinician PII.
 * - Clinician verification status is strictly enforced.
 * - Document storage keys are UUID-based, never containing patient identifiers.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const userRoleEnum = pgEnum("user_role", [
  "patient",
  "guardian",
  "clinician",
  "facility-admin",
  "pharmacy-staff",
  "platform-admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "pending_verification",
]);

export const guardianshipRelationshipEnum = pgEnum("guardianship_relationship", [
  "mother",
  "father",
  "legal_guardian",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "pending",
  "verified",
  "rejected",
  "revoked",
]);

export const auditOutcomeEnum = pgEnum("audit_outcome", [
  "SUCCESS",
  "FAILURE",
  "DENIED",
]);

// Vault enumerations
export const documentTypeEnum = pgEnum("document_type", [
  "scan",
  "lab",
  "prescription",
  "vaccination",
  "discharge",
]);

export const uploadSourceEnum = pgEnum("upload_source", [
  "patient-uploaded",
  "facility-verified",
]);

export const documentScanStatusEnum = pgEnum("document_scan_status", [
  "pending",
  "scanning",
  "clean",
  "infected",
  "scan_failed",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "quarantined",
  "ready",
  "deleted",
  "rejected",
]);

// ---------------------------------------------------------------------------
// 1. Users (Identity Anchor)
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keycloakId: varchar("keycloak_id", { length: 255 }),
    phone: varchar("phone", { length: 20 }).unique(),
    email: varchar("email", { length: 255 }).unique(),
    role: userRoleEnum("role").notNull().default("patient"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_keycloak_id_idx").on(table.keycloakId),
    index("users_role_idx").on(table.role),
  ]
);

// ---------------------------------------------------------------------------
// 2. Patients
// ---------------------------------------------------------------------------
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    healthId: varchar("health_id", { length: 64 }).notNull().unique(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    dateOfBirth: varchar("date_of_birth", { length: 10 }), // YYYY-MM-DD
    gender: varchar("gender", { length: 20 }),
    bloodGroup: varchar("blood_group", { length: 10 }),
    phoneHash: varchar("phone_hash", { length: 64 }).notNull(), // blind index
    encryptedPhone: text("encrypted_phone").notNull(), // AES-256-GCM
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("patients_health_id_idx").on(table.healthId),
    index("patients_phone_hash_idx").on(table.phoneHash),
    index("patients_user_id_idx").on(table.userId),
  ]
);

// ---------------------------------------------------------------------------
// 3. Clinicians
// ---------------------------------------------------------------------------
export const clinicians = pgTable(
  "clinicians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    registrationNumber: varchar("registration_number", { length: 100 })
      .notNull()
      .unique(),
    stateMedicalCouncil: varchar("state_medical_council", { length: 100 }).notNull(),
    qualification: varchar("qualification", { length: 100 }),
    specialization: varchar("specialization", { length: 100 }),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("clinicians_user_id_idx").on(table.userId),
    index("clinicians_verified_idx").on(table.isVerified),
  ]
);

// ---------------------------------------------------------------------------
// 4. Guardianships (Mother-Child Linkage)
// ---------------------------------------------------------------------------
export const guardianships = pgTable(
  "guardianships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guardianPatientId: uuid("guardian_patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    wardPatientId: uuid("ward_patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    relationship: guardianshipRelationshipEnum("relationship").notNull(),
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("pending"),
    proofDocumentId: varchar("proof_document_id", { length: 255 }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("guardianships_guardian_idx").on(table.guardianPatientId),
    index("guardianships_ward_idx").on(table.wardPatientId),
  ]
);

// ---------------------------------------------------------------------------
// 5. Sessions (Device tracking, Refresh token rotation & Revocation)
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),
    deviceInfo: varchar("device_info", { length: 255 }).default("Unknown Device"),
    ipAddress: varchar("ip_address", { length: 45 }).default("127.0.0.1"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_refresh_hash_idx").on(table.refreshTokenHash),
  ]
);

// ---------------------------------------------------------------------------
// 6. Audit Events (Tamper-Evident SHA-256 Chained Ledger)
// ---------------------------------------------------------------------------
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id),
    actorRole: varchar("actor_role", { length: 50 }),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }).notNull(),
    outcome: auditOutcomeEnum("outcome").notNull(),
    ipHash: varchar("ip_hash", { length: 64 }).notNull(),
    userAgent: varchar("user_agent", { length: 255 }),
    integrityHash: varchar("integrity_hash", { length: 64 }).notNull(),
    previousHash: varchar("previous_hash", { length: 64 }).notNull(),
  },
  (table) => [
    index("audit_events_timestamp_idx").on(table.timestamp),
    index("audit_events_actor_idx").on(table.actorId),
    index("audit_events_action_idx").on(table.action),
  ]
);

// ===========================================================================
// VAULT — Document Record Tables
// ===========================================================================

// ---------------------------------------------------------------------------
// 7. Documents (Core vault record — never stores plaintext PII or filenames)
// ---------------------------------------------------------------------------
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Opaque patient ID — never expose/log health IDs or phone numbers */
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Whether this was uploaded by the patient themselves or a verified facility */
    uploadSource: uploadSourceEnum("upload_source").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    /** Randomized storage key with NO patient info (UUID-based). Never a real filename. */
    storageKey: varchar("storage_key", { length: 512 }).notNull().unique(),
    storageBucket: varchar("storage_bucket", { length: 128 }).notNull(),
    /** MIME type determined from magic bytes, not file extension */
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    /** Original file size in bytes (before encryption) */
    fileSizeBytes: integer("file_size_bytes").notNull(),
    /** Current lifecycle status */
    status: documentStatusEnum("status").notNull().default("quarantined"),
    scanStatus: documentScanStatusEnum("scan_status").notNull().default("pending"),
    scanCompletedAt: timestamp("scan_completed_at", { withTimezone: true }),
    scanThreatName: varchar("scan_threat_name", { length: 255 }),
    /** Clinical document date (e.g. date of lab test or prescription), not upload date */
    documentDate: timestamp("document_date", { withTimezone: true }),
    /** Facility that uploaded (nullable for patient-uploaded) */
    facilityId: uuid("facility_id"),
    /** Notes stripped of PII — opaque references only */
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_patient_id_idx").on(table.patientId),
    index("documents_uploader_id_idx").on(table.uploaderId),
    index("documents_status_idx").on(table.status),
    index("documents_type_idx").on(table.documentType),
    index("documents_document_date_idx").on(table.documentDate),
    index("documents_scan_status_idx").on(table.scanStatus),
  ]
);

// ---------------------------------------------------------------------------
// 8. Document Crypto Keys (Envelope encryption — wrapped DEKs only, never plaintext)
// ---------------------------------------------------------------------------
export const documentCryptoKeys = pgTable(
  "document_crypto_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .unique()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Base64-encoded ciphertext of the AES-256 DEK wrapped by the KMS master key */
    wrappedDek: text("wrapped_dek").notNull(),
    /** KMS key alias / ARN / ID used for wrapping */
    kmsKeyId: varchar("kms_key_id", { length: 255 }).notNull(),
    /** Encryption algorithm used for the document payload */
    algorithm: varchar("algorithm", { length: 32 }).notNull().default("aes-256-gcm"),
    /** Base64-encoded 12-byte GCM initialization vector */
    iv: varchar("iv", { length: 32 }).notNull(),
    /** Base64-encoded 16-byte GCM authentication tag */
    authTag: varchar("auth_tag", { length: 32 }).notNull(),
    /** Hex SHA-256 of plaintext document bytes — verified on every decryption */
    sha256Plaintext: varchar("sha256_plaintext", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("doc_crypto_keys_document_id_idx").on(table.documentId),
  ]
);

// ---------------------------------------------------------------------------
// 9. Document Versions (Immutable version chain for amendments)
// ---------------------------------------------------------------------------
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    /** Storage key for this specific version */
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    storageBucket: varchar("storage_bucket", { length: 128 }).notNull(),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sha256Plaintext: varchar("sha256_plaintext", { length: 64 }).notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("doc_versions_document_id_idx").on(table.documentId),
  ]
);

// ---------------------------------------------------------------------------
// 10. FHIR DocumentReferences (HL7 FHIR R4 resource JSON — stored as JSONB)
// ---------------------------------------------------------------------------
export const fhirDocumentReferences = pgTable(
  "fhir_document_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .unique()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** The complete FHIR R4 DocumentReference resource as JSONB */
    resource: jsonb("resource").notNull(),
    /** FHIR resource ID (separate from our internal document id) */
    fhirId: varchar("fhir_id", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fhir_doc_refs_document_id_idx").on(table.documentId),
    uniqueIndex("fhir_doc_refs_fhir_id_idx").on(table.fhirId),
  ]
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
export type Clinician = typeof clinicians.$inferSelect;
export type NewClinician = typeof clinicians.$inferInsert;
export type Guardianship = typeof guardianships.$inferSelect;
export type NewGuardianship = typeof guardianships.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// Vault types
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentCryptoKey = typeof documentCryptoKeys.$inferSelect;
export type NewDocumentCryptoKey = typeof documentCryptoKeys.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type FhirDocumentReference = typeof fhirDocumentReferences.$inferSelect;
export type NewFhirDocumentReference = typeof fhirDocumentReferences.$inferInsert;
