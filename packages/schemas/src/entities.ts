import { z } from "zod";

// --- Enumerations ---
export const UserRoleEnum = z.enum([
  "patient",
  "guardian",
  "clinician",
  "facility_staff",
  "admin",
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

export const VerificationStatusEnum = z.enum([
  "unverified",
  "pending",
  "verified",
  "suspended",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const DocumentTypeEnum = z.enum([
  "scan",
  "lab",
  "prescription",
  "vaccination",
  "discharge",
]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const DocumentSourceEnum = z.enum([
  "facility_verified",
  "patient_uploaded",
]);
export type DocumentSource = z.infer<typeof DocumentSourceEnum>;

export const ScanStatusEnum = z.enum(["pending", "clean", "infected"]);
export type ScanStatus = z.infer<typeof ScanStatusEnum>;

export const ConsentStatusEnum = z.enum(["active", "revoked", "expired"]);
export type ConsentStatus = z.infer<typeof ConsentStatusEnum>;

export const AccessRequestStatusEnum = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type AccessRequestStatus = z.infer<typeof AccessRequestStatusEnum>;

export const EmergencyReasonCodeEnum = z.enum([
  "maternal_obstetric_distress",
  "neonatal_pediatric_crisis",
  "cardiovascular_event",
  "severe_trauma",
  "acute_unresponsive_shock",
  "critical_anaphylaxis",
]);
export type EmergencyReasonCode = z.infer<typeof EmergencyReasonCodeEnum>;

export const EmergencyReviewStatusEnum = z.enum([
  "pending_review",
  "reviewed_justified",
  "flagged_misuse",
]);
export type EmergencyReviewStatus = z.infer<typeof EmergencyReviewStatusEnum>;

export const AuditOutcomeEnum = z.enum(["success", "denied", "failed"]);
export type AuditOutcome = z.infer<typeof AuditOutcomeEnum>;

// --- Entity Schemas ---

export const UserSchema = z.object({
  id: z.string().uuid(),
  phone: z
    .string()
    .regex(
      /^\+91[6-9]\d{9}$/,
      "Invalid Indian mobile number format (+91XXXXXXXXXX)",
    ),
  email: z.string().email().optional(),
  role: UserRoleEnum,
  status: z.enum(["active", "inactive", "suspended"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const PatientSchema = z.object({
  id: z.string().uuid(),
  healthId: z
    .string()
    .regex(
      /^MQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
      "Health ID format must be MQ-XXXX-XXXX-XXXX",
    ),
  userId: z.string().uuid(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD format required"),
  gender: z.enum(["female", "male", "other"]),
  bloodGroup: z
    .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "UNKNOWN"])
    .default("UNKNOWN"),
  allergies: z.array(z.string().min(1).max(100)).default([]),
  emergencyContact: z.object({
    name: z.string().min(2),
    relationship: z.string().min(2),
    phone: z.string().regex(/^\+91[6-9]\d{9}$/),
  }),
  primaryLanguage: z.enum(["en", "ta", "hi"]).default("en"),
  createdAt: z.string().datetime(),
});
export type Patient = z.infer<typeof PatientSchema>;

export const GuardianshipSchema = z.object({
  id: z.string().uuid(),
  guardianUserId: z.string().uuid(),
  patientId: z.string().uuid(),
  relationship: z.enum(["mother", "father", "legal_guardian"]),
  verificationStatus: VerificationStatusEnum,
  createdAt: z.string().datetime(),
});
export type Guardianship = z.infer<typeof GuardianshipSchema>;

export const FacilitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(200),
  registrationNumber: z.string().min(4).max(100),
  facilityType: z.enum(["hospital", "clinic", "diagnostic_center", "pharmacy"]),
  verificationStatus: VerificationStatusEnum,
  state: z.string().min(2),
  pincode: z.string().regex(/^\d{6}$/, "Must be valid 6-digit Indian PIN code"),
  createdAt: z.string().datetime(),
});
export type Facility = z.infer<typeof FacilitySchema>;

export const ClinicianSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  facilityId: z.string().uuid(),
  name: z.string().min(2).max(100),
  medicalCouncilNumber: z.string().min(4).max(50),
  stateCouncil: z.string().min(2),
  specialty: z.string().min(2),
  verificationStatus: VerificationStatusEnum,
  createdAt: z.string().datetime(),
});
export type Clinician = z.infer<typeof ClinicianSchema>;

export const QRCredentialSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  tokenHash: z.string().length(64, "SHA-256 hash must be 64 characters"),
  status: z.enum(["active", "rotated", "revoked"]),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type QRCredential = z.infer<typeof QRCredentialSchema>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  type: DocumentTypeEnum,
  source: DocumentSourceEnum,
  title: z.string().min(2).max(200),
  storageKey: z.string().min(5),
  wrappedDataKey: z.string().min(16),
  sha256Checksum: z.string().length(64),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileSizeBytes: z.number().int().positive(),
  scanStatus: ScanStatusEnum,
  facilityId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const ConsentSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  grantedByUserId: z.string().uuid(),
  granteeClinicianId: z.string().uuid(),
  scope: z.array(DocumentTypeEnum).min(1),
  purpose: z.string().min(5).max(300),
  status: ConsentStatusEnum,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const EmergencyGrantSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  facilityId: z.string().uuid(),
  reasonCode: EmergencyReasonCodeEnum,
  clinicalJustification: z.string().min(10).max(500),
  scope: z.literal("emergency_summary"),
  expiresAt: z.string().datetime(), // Enforced max 30 min from creation
  reviewStatus: EmergencyReviewStatusEnum,
  reviewedByAdminId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type EmergencyGrant = z.infer<typeof EmergencyGrantSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  prevHash: z
    .string()
    .length(64, "Previous SHA-256 hash required for tamper-evident chain"),
  hash: z.string().length(64, "Current SHA-256 hash"),
  actorUserId: z.string().uuid(),
  actorRole: UserRoleEnum,
  action: z.enum([
    "READ_RECORD",
    "GRANT_CONSENT",
    "REVOKE_CONSENT",
    "EMERGENCY_ACCESS",
    "ROTATE_QR",
    "UPLOAD_RECORD",
  ]),
  resourceType: z.enum([
    "document",
    "patient",
    "consent",
    "emergency_grant",
    "qr_credential",
  ]),
  resourceId: z.string(),
  purpose: z.string().min(1),
  outcome: AuditOutcomeEnum,
  clientIpHash: z.string().length(64),
  timestamp: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
