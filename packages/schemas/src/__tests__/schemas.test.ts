import { describe, it, expect } from "vitest";
import {
  PatientSchema,
  QRCredentialSchema,
  AuditEventSchema,
  EmergencyGrantSchema,
  UserSchema,
} from "../entities.js";

describe("Domain Schemas Validation", () => {
  it("validates Indian phone numbers strictly (+91)", () => {
    const validUser = {
      id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      phone: "+919876543210",
      email: "asha.worker@health.org.in",
      role: "clinician" as const,
      status: "active" as const,
      createdAt: "2026-10-03T12:00:00Z",
      updatedAt: "2026-10-03T12:00:00Z",
    };
    expect(UserSchema.parse(validUser)).toEqual(validUser);

    const invalidPhone = { ...validUser, phone: "9876543210" }; // Missing +91
    expect(() => UserSchema.parse(invalidPhone)).toThrow();
  });

  it("validates Health ID format (MQ-XXXX-XXXX-XXXX)", () => {
    const validPatient = {
      id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      healthId: "MQ-8F2A-99BC-41E0",
      userId: "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e",
      dateOfBirth: "1995-04-12",
      gender: "female" as const,
      bloodGroup: "O+" as const,
      allergies: ["Penicillin", "Sulfa drugs"],
      emergencyContact: {
        name: "Ramesh Sharma",
        relationship: "husband",
        phone: "+919876543211",
      },
      primaryLanguage: "hi" as const,
      createdAt: "2026-10-03T12:00:00Z",
    };
    expect(PatientSchema.parse(validPatient)).toEqual(validPatient);

    const invalidHealthId = { ...validPatient, healthId: "MQ12345" };
    expect(() => PatientSchema.parse(invalidHealthId)).toThrow();
  });

  it("enforces opaque 64-char SHA-256 hash in QR credential", () => {
    const credential = {
      id: "c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f",
      patientId: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      tokenHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      status: "active" as const,
      expiresAt: null,
      createdAt: "2026-10-03T12:00:00Z",
    };
    expect(QRCredentialSchema.parse(credential)).toEqual(credential);

    const invalidHash = { ...credential, tokenHash: "too-short-token" };
    expect(() => QRCredentialSchema.parse(invalidHash)).toThrow();
  });

  it("enforces emergency grant scope restricted to emergency_summary", () => {
    const grant = {
      id: "d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a",
      patientId: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      clinicianId: "e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b",
      facilityId: "f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c",
      reasonCode: "maternal_obstetric_distress" as const,
      clinicalJustification:
        "Patient presented with acute late-trimester hemorrhage.",
      scope: "emergency_summary" as const,
      expiresAt: "2026-10-03T12:30:00Z",
      reviewStatus: "pending_review" as const,
      createdAt: "2026-10-03T12:00:00Z",
    };
    expect(EmergencyGrantSchema.parse(grant)).toEqual(grant);
  });

  it("validates append-only audit event schema with hash-chaining fields", () => {
    const audit = {
      id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      prevHash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      actorUserId: "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e",
      actorRole: "clinician" as const,
      action: "READ_RECORD" as const,
      resourceType: "document" as const,
      resourceId: "doc-12345",
      purpose: "Consultation ANC visit #3",
      outcome: "success" as const,
      clientIpHash:
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      timestamp: "2026-10-03T12:00:00Z",
    };
    expect(AuditEventSchema.parse(audit)).toEqual(audit);
  });
});
