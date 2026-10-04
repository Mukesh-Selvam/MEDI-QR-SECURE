/**
 * AuditEvent types for the MediQR tamper-evident audit ledger.
 * NEVER include plaintext PII (phone, name, email, Aadhaar) in audit logs.
 * All subject references use opaque UUIDs only.
 */

export type AuditAction =
  | "AUTH_OTP_SEND"
  | "AUTH_OTP_VERIFY_SUCCESS"
  | "AUTH_OTP_VERIFY_FAIL"
  | "AUTH_OTP_RATE_LIMITED"
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAIL"
  | "AUTH_LOGOUT"
  | "AUTH_REFRESH"
  | "AUTH_REFRESH_TOKEN_REUSE_DETECTED"
  | "AUTH_SESSION_REVOKE"
  | "AUTH_SESSION_REVOKE_ALL"
  | "QR_CREDENTIAL_ISSUED"
  | "QR_CREDENTIAL_ROTATED"
  | "QR_CREDENTIAL_REVOKED"
  | "QR_RESOLUTION_SUCCESS"
  | "QR_RESOLUTION_UNKNOWN"
  | "QR_RESOLUTION_EXPIRED"
  | "QR_RESOLUTION_REVOKED"
  | "QR_RESOLUTION_RATE_LIMITED"
  | "QR_RESOLUTION_REPLAYED"
  | "QR_RESOLUTION_FAILURE"
  | "ACCESS_REQUEST_CREATED"
  | "ACCESS_REQUEST_APPROVED"
  | "ACCESS_REQUEST_DENIED"
  | "ACCESS_REQUEST_OTP_ISSUED"
  | "ACCESS_REQUEST_OTP_APPROVED"
  | "CLINICIAN_VERIFIED"
  | "CLINICIAN_SUSPENDED"
  | "GUARDIANSHIP_CREATED"
  | "GUARDIANSHIP_VERIFIED"
  | "GUARDIANSHIP_REVOKED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_ACCESSED"
  | "DOCUMENT_VIEWED"
  | "DOCUMENT_TIMELINE_VIEWED"
  | "DOCUMENT_DELETED"
  | "SCAN_SUCCESS"
  | "SCAN_FAILED"
  | "SCAN_ALERT_INFECTED"
  | "ACCESS_GRANT_CREATED"
  | "ACCESS_GRANT_REVOKED"
  | "CONSENT_GRANTED"
  | "CONSENT_REVOKED";


export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

export interface AuditEventInput {
  /** Opaque UUID of the acting user (never PII) */
  actorId?: string;
  actorRole?: string;
  action: AuditAction;
  resourceType: string;
  /** Opaque UUID of the resource (never PII) */
  resourceId: string;
  outcome: AuditOutcome;
  /** HMAC of the IP address (never raw IP) */
  ipHash: string;
  userAgent?: string;
}
