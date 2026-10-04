import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisClient } from "../../config/redis.config.js";
import { db, pool } from "../../database/index.js";
import {
  accessRequests,
  auditEvents,
  clinicians,
  guardianships,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { AuditService } from "../audit/audit.service.js";
import { AccessRequestApprovalService } from "./access-request-approval.service.js";

describe("Access request approval flow (integration)", () => {
  const suffix = randomUUID();
  let patientUserId: string;
  let guardianUserId: string;
  let wardUserId: string;
  let patientId: string;
  let guardianPatientId: string;
  let wardPatientId: string;
  let requestId: string;
  let otherRequestId: string;
  let clinicianUserId: string;
  let patientCredentialId: string;
  let wardCredentialId: string;
  let service: AccessRequestApprovalService;
  let audit: AuditService;

  beforeAll(async () => {
    const migration = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'access_requests'`
    );
    expect(migration.rows).toHaveLength(1);

    const [patientUser] = await db
      .insert(users)
      .values({
        email: `approval-patient-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    patientUserId = patientUser.id;

    const [patient] = await db
      .insert(patients)
      .values({
        userId: patientUser.id,
        healthId: `PAT-${suffix}`,
        fullName: "Approval Patient",
        phoneHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "patient-approval-test-ciphertext",
      })
      .returning({ id: patients.id });
    patientId = patient.id;

    const [guardianUser] = await db
      .insert(users)
      .values({
        email: `approval-guardian-${suffix}@mediqr.invalid`,
        role: "guardian",
        status: "active",
      })
      .returning({ id: users.id });
    guardianUserId = guardianUser.id;

    const [guardianPatient] = await db
      .insert(patients)
      .values({
        userId: guardianUser.id,
        healthId: `GUARD-${suffix}`,
        fullName: "Guardian Persona",
        phoneHash: `guardian-${suffix}`.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "guardian-approval-test-ciphertext",
      })
      .returning({ id: patients.id });
    guardianPatientId = guardianPatient.id;

    const [wardUser] = await db
      .insert(users)
      .values({
        email: `approval-ward-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    wardUserId = wardUser.id;

    const [wardPatient] = await db
      .insert(patients)
      .values({
        userId: wardUser.id,
        healthId: `WARD-${suffix}`,
        fullName: "Ward Patient",
        phoneHash: `ward-${suffix}`.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "ward-approval-test-ciphertext",
      })
      .returning({ id: patients.id });
    wardPatientId = wardPatient.id;

    await db.insert(guardianships).values({
      guardianPatientId: guardianPatientId,
      wardPatientId,
      relationship: "mother",
      verificationStatus: "verified",
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const [clinicianUser] = await db
      .insert(users)
      .values({
        email: `approval-clinician-${suffix}@mediqr.invalid`,
        keycloakId: `approval-clinician-${suffix}`,
        role: "clinician",
        status: "active",
      })
      .returning({ id: users.id });
    clinicianUserId = clinicianUser.id;

    await db.insert(clinicians).values({
      userId: clinicianUser.id,
      fullName: "Approval Clinician",
      registrationNumber: `CLIN-${suffix}`,
      stateMedicalCouncil: "Test State Council",
      isVerified: true,
    });

    const [primaryCredential] = await db
      .insert(qrCredentials)
      .values({
        patientId,
        tokenHash: createHash("sha256").update(`approval-primary-${suffix}`).digest("hex"),
        status: "active",
      })
      .returning({ id: qrCredentials.id });
    patientCredentialId = primaryCredential.id;

    const [wardCredential] = await db
      .insert(qrCredentials)
      .values({
        patientId: wardPatientId,
        tokenHash: createHash("sha256").update(`approval-ward-${suffix}`).digest("hex"),
        status: "active",
      })
      .returning({ id: qrCredentials.id });
    wardCredentialId = wardCredential.id;

    const [request] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId: clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    requestId = request.id;

    const [otherRequest] = await db
      .insert(accessRequests)
      .values({
        patientId: wardPatientId,
        clinicianUserId: clinicianUserId,
        sourceQrCredentialId: wardCredentialId,
        purpose: "continuity-of-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    otherRequestId = otherRequest.id;

    audit = new AuditService();
    service = new AccessRequestApprovalService(audit, createRedisClient());
  });

  afterAll(async () => {
    const patientIds = [patientId, guardianPatientId, wardPatientId];
    await db.delete(accessRequests).where(inArray(accessRequests.patientId, patientIds));
    await db.delete(qrCredentials).where(inArray(qrCredentials.patientId, patientIds));
    await db.delete(guardianships).where(eq(guardianships.wardPatientId, wardPatientId));
    await db.delete(patients).where(inArray(patients.id, patientIds));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, patientUserId));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, guardianUserId));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, clinicianUserId));
    await db.delete(clinicians).where(eq(clinicians.userId, clinicianUserId));
    await db.delete(users).where(eq(users.id, patientUserId));
    await db.delete(users).where(eq(users.id, guardianUserId));
    await db.delete(users).where(eq(users.id, wardUserId));
    await db.delete(users).where(eq(users.id, clinicianUserId));
    await pool.end();
  });

  it("approves the patient's own access request and records the audit event", async () => {
    const patientUser: AuthenticatedUser = {
      id: patientUserId,
      sub: `approval-patient-${suffix}`,
      role: "patient",
    };

    await expect(
      service.approve(requestId, patientUser, audit.hashIp("127.0.0.1"))
    ).resolves.toEqual({ status: "approved" });

    const [request] = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, requestId));
    expect(request.status).toBe("approved");
    expect(request.decidedByUserId).toBe(patientUserId);
  });

  it("allows a verified guardian to approve a ward request and denies other children", async () => {
    const guardianUser: AuthenticatedUser = {
      id: guardianUserId,
      sub: `approval-guardian-${suffix}`,
      role: "guardian",
    };

    await expect(
      service.approve(otherRequestId, guardianUser, audit.hashIp("127.0.0.1"))
    ).resolves.toEqual({ status: "approved" });

    const [unrelatedUser] = await db
      .insert(users)
      .values({
        email: `approval-unrelated-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });

    const [unrelatedPatient] = await db
      .insert(patients)
      .values({
        userId: unrelatedUser.id,
        healthId: `UNRELATED-${suffix}`,
        fullName: "Unauthorised Patient",
        phoneHash: `unrelated-${suffix}`.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "unauthorised-test-ciphertext",
      })
      .returning({ id: patients.id });

    const [unrelatedCredential] = await db
      .insert(qrCredentials)
      .values({
        patientId: unrelatedPatient.id,
        tokenHash: createHash("sha256").update(`approval-unrelated-${suffix}`).digest("hex"),
        status: "active",
      })
      .returning({ id: qrCredentials.id });

    const [blockedRequest] = await db
      .insert(accessRequests)
      .values({
        patientId: unrelatedPatient.id,
        clinicianUserId: clinicianUserId,
        sourceQrCredentialId: unrelatedCredential.id,
        purpose: "medication-review",
        scope: ["document:prescription"],
      })
      .returning({ id: accessRequests.id });

    await expect(
      service.approve(blockedRequest.id, guardianUser, audit.hashIp("127.0.0.1"))
    ).rejects.toThrow(/not authorized|Approval is not authorized/i);

    await db.delete(accessRequests).where(eq(accessRequests.id, blockedRequest.id));
    await db.delete(qrCredentials).where(eq(qrCredentials.id, unrelatedCredential.id));
    await db.delete(patients).where(eq(patients.id, unrelatedPatient.id));
    await db.delete(users).where(eq(users.id, unrelatedUser.id));
  });

  it("issues and consumes a one-time approval OTP for patient or guardian confirmation", async () => {
    const clinicianUser: AuthenticatedUser = {
      id: clinicianUserId,
      sub: `approval-clinician-${suffix}`,
      role: "clinician",
      isVerified: true,
    };
    const patientUser: AuthenticatedUser = {
      id: patientUserId,
      sub: `approval-patient-${suffix}`,
      role: "patient",
    };

    const [freshRequest] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId: clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "continuity-of-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });

    const challenge = await service.issueApprovalOtp(
      freshRequest.id,
      patientUser,
      audit.hashIp("127.0.0.1")
    );
    expect(challenge.code).toMatch(/^\d{6}$/);

    await expect(
      service.approveWithOtp(
        freshRequest.id,
        challenge.code,
        clinicianUser,
        audit.hashIp("127.0.0.1")
      )
    ).resolves.toEqual({ status: "approved" });

    await db.delete(accessRequests).where(eq(accessRequests.id, freshRequest.id));
  });
});
