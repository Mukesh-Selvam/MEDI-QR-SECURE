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
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

export const qrCredentialStatusEnum = pgEnum("qr_credential_status", [
  "active",
  "rotated",
  "revoked",
]);

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
  "revoked",
]);

export const accessPurposeEnum = pgEnum("access_purpose", [
  "clinical-care",
  "medication-review",
  "vaccination-follow-up",
  "continuity-of-care",
]);

export const accessScopeEnum = pgEnum("access_scope", [
  "timeline",
  "document:scan",
  "document:lab",
  "document:prescription",
  "document:vaccination",
  "document:discharge",
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
    facilityId: uuid("facility_id"),
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

export const emergencyProfiles = pgTable(
  "emergency_profiles",
  {
    patientId: uuid("patient_id")
      .primaryKey()
      .references(() => patients.id, { onDelete: "cascade" }),
    encryptedPayload: text("encrypted_payload").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    kmsKeyId: varchar("kms_key_id", { length: 255 }).notNull(),
    iv: varchar("iv", { length: 64 }).notNull(),
    authTag: varchar("auth_tag", { length: 64 }).notNull(),
    sha256Plaintext: varchar("sha256_plaintext", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("emergency_profiles_enabled_idx").on(table.enabled)]
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

export const patientFacilityRelationships = pgTable(
  "patient_facility_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("patient_facility_relationship_pair_idx").on(
      table.patientId,
      table.facilityId
    ),
    index("patient_facility_relationship_facility_idx").on(table.facilityId),
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
    accessTokenIdHash: varchar("access_token_id_hash", { length: 64 }),
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
    uniqueIndex("sessions_access_token_id_hash_idx").on(table.accessTokenIdHash),
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
    actorId: uuid("actor_id"),
    actorRole: varchar("actor_role", { length: 50 }),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }).notNull(),
    outcome: auditOutcomeEnum("outcome").notNull(),
    ipHash: varchar("ip_hash", { length: 64 }).notNull(),
    userAgent: varchar("user_agent", { length: 255 }),
    integrityHash: varchar("integrity_hash", { length: 64 }).notNull(),
    previousHash: varchar("previous_hash", { length: 64 }).notNull(),
    eventIndex: bigint("event_index", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    index("audit_events_timestamp_idx").on(table.timestamp),
    index("audit_events_actor_idx").on(table.actorId),
    index("audit_events_action_idx").on(table.action),
    uniqueIndex("audit_events_event_index_idx").on(table.eventIndex),
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
// 11. QR Credentials (opaque bearer credentials; only token hashes persist)
// ---------------------------------------------------------------------------
export const qrCredentials = pgTable(
  "qr_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    status: qrCredentialStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("qr_credentials_patient_id_idx").on(table.patientId),
    uniqueIndex("qr_credentials_one_active_per_patient_idx")
      .on(table.patientId)
      .where(sql`${table.status} = 'active'`),
  ]
);

// ---------------------------------------------------------------------------
// 12. Access Requests (clinician requests that a patient can approve)
// ---------------------------------------------------------------------------
export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceQrCredentialId: uuid("source_qr_credential_id")
      .notNull()
      .references(() => qrCredentials.id, { onDelete: "restrict" }),
    purpose: accessPurposeEnum("purpose").notNull(),
    scope: jsonb("scope").$type<(typeof accessScopeEnum.enumValues)[number][]>().notNull(),
    status: accessRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  },
  (table) => [
    index("access_requests_patient_status_idx").on(table.patientId, table.status),
    index("access_requests_clinician_idx").on(table.clinicianUserId),
  ]
);

export const consentStatusEnum = pgEnum("consent_status", [
  "active",
  "revoked",
  "expired",
]);

export const notificationEventTypeEnum = pgEnum("notification_event_type", [
  "ACCESS_REQUESTED",
  "ACCESS_APPROVED",
  "ACCESS_DENIED",
  "DOCUMENT_READ",
  "ACCESS_REVOKED",
]);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accessRequestId: uuid("access_request_id")
      .notNull()
      .unique()
      .references(() => accessRequests.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    granteeUserId: uuid("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scope: jsonb("scope").$type<(typeof accessScopeEnum.enumValues)[number][]>().notNull(),
    purpose: accessPurposeEnum("purpose").notNull(),
    status: consentStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("consents_patient_status_idx").on(table.patientId, table.status),
    index("consents_grantee_idx").on(table.granteeUserId),
    index("consents_expiry_idx").on(table.expiresAt),
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: notificationEventTypeEnum("event_type").notNull(),
    requestId: uuid("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_recipient_created_idx").on(
      table.recipientUserId,
      table.createdAt
    ),
    index("notifications_recipient_unread_idx").on(
      table.recipientUserId,
      table.readAt
    ),
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
export type PatientFacilityRelationship =
  typeof patientFacilityRelationships.$inferSelect;
export type NewPatientFacilityRelationship =
  typeof patientFacilityRelationships.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type QrCredential = typeof qrCredentials.$inferSelect;
export type NewQrCredential = typeof qrCredentials.$inferInsert;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type NewAccessRequest = typeof accessRequests.$inferInsert;
export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;

// Vault types
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentCryptoKey = typeof documentCryptoKeys.$inferSelect;
export type NewDocumentCryptoKey = typeof documentCryptoKeys.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type FhirDocumentReference = typeof fhirDocumentReferences.$inferSelect;
export type NewFhirDocumentReference = typeof fhirDocumentReferences.$inferInsert;
