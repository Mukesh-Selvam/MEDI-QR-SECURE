import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisClient } from "../../config/redis.config.js";
import { db, pool } from "../../database/index.js";
import {
  accessRequests,
  auditEvents,
  clinicians,
  consents,
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
  let otherClinicianUserId: string;
  let patientCredentialId: string;
  let wardCredentialId: string;
  let service: AccessRequestApprovalService;
  let audit: AuditService;
  let redisClient: ReturnType<typeof createRedisClient>;

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

    const [otherClinicianUser] = await db
      .insert(users)
      .values({
        email: `approval-other-clinician-${suffix}@mediqr.invalid`,
        keycloakId: `approval-other-clinician-${suffix}`,
        role: "clinician",
        status: "active",
      })
      .returning({ id: users.id });
    otherClinicianUserId = otherClinicianUser.id;
    await db.insert(clinicians).values({
      userId: otherClinicianUser.id,
      fullName: "Second Approval Clinician",
      registrationNumber: `SECOND-${suffix}`,
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
    redisClient = createRedisClient();
    service = new AccessRequestApprovalService(audit, redisClient);
  });

  afterAll(async () => {
    const patientIds = [patientId, guardianPatientId, wardPatientId];
    await db.delete(accessRequests).where(inArray(accessRequests.patientId, patientIds));
    await db.delete(consents).where(inArray(consents.patientId, patientIds));
    await db.delete(qrCredentials).where(inArray(qrCredentials.patientId, patientIds));
    await db.delete(guardianships).where(eq(guardianships.wardPatientId, wardPatientId));
    await db.delete(patients).where(inArray(patients.id, patientIds));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, patientUserId));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, guardianUserId));
    await db.delete(auditEvents).where(eq(auditEvents.actorId, clinicianUserId));
    await db.delete(clinicians).where(eq(clinicians.userId, clinicianUserId));
    await db.delete(clinicians).where(eq(clinicians.userId, otherClinicianUserId));
    await db.delete(users).where(eq(users.id, patientUserId));
    await db.delete(users).where(eq(users.id, guardianUserId));
    await db.delete(users).where(eq(users.id, wardUserId));
    await db.delete(users).where(eq(users.id, clinicianUserId));
    await db.delete(users).where(eq(users.id, otherClinicianUserId));
    redisClient.disconnect();
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

    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.accessRequestId, requestId));
    expect(consent).toMatchObject({
      patientId,
      granteeUserId: clinicianUserId,
      purpose: "clinical-care",
      scope: ["timeline"],
      status: "active",
    });
    expect(consent.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(consent.expiresAt.getTime()).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);

    await expect(
      service.approve(requestId, patientUser, audit.hashIp("127.0.0.1"))
    ).rejects.toThrow(/no longer pending/i);
    const duplicateConsents = await db
      .select()
      .from(consents)
      .where(eq(consents.accessRequestId, requestId));
    expect(duplicateConsents).toHaveLength(1);
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

    await expect(
      service.approveWithOtp(
        freshRequest.id,
        challenge.code,
        clinicianUser,
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/invalid or expired/i);
    await db.delete(accessRequests).where(eq(accessRequests.id, freshRequest.id));
  });

  it.each(["denied", "expired", "revoked"] as const)(
    "rejects approval when the request is already %s",
    async (status) => {
      const [staleRequest] = await db
        .insert(accessRequests)
        .values({
          patientId,
          clinicianUserId,
          sourceQrCredentialId: patientCredentialId,
          purpose: "clinical-care",
          scope: ["timeline"],
          status,
        })
        .returning({ id: accessRequests.id });
      const patientUser: AuthenticatedUser = {
        id: patientUserId,
        sub: `approval-patient-${suffix}`,
        role: "patient",
      };

      await expect(
        service.approve(staleRequest.id, patientUser, audit.hashIp("127.0.0.1"))
      ).rejects.toThrow(/no longer pending/i);
      expect(
        await db
          .select()
          .from(consents)
          .where(eq(consents.accessRequestId, staleRequest.id))
      ).toHaveLength(0);
      await db.delete(accessRequests).where(eq(accessRequests.id, staleRequest.id));
    }
  );

  it("denies a clinician their own approval and denies a guardian with an expired relationship", async () => {
    const clinician: AuthenticatedUser = {
      id: clinicianUserId,
      sub: `approval-clinician-${suffix}`,
      role: "clinician",
      isVerified: true,
    };
    await expect(
      service.approve(requestId, clinician, audit.hashIp("127.0.0.1"))
    ).rejects.toThrow(/patient or guardian/i);

    const [unrelatedUser] = await db
      .insert(users)
      .values({
        email: `approval-expired-ward-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    const [expiredWard] = await db
      .insert(patients)
      .values({
        userId: unrelatedUser.id,
        healthId: `EXPIRED-WARD-${suffix}`,
        fullName: "Expired Ward",
        phoneHash: `expired-ward-${suffix}`.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "expired-ward-test-ciphertext",
      })
      .returning({ id: patients.id });
    const [expiredCredential] = await db
      .insert(qrCredentials)
      .values({
        patientId: expiredWard.id,
        tokenHash: createHash("sha256").update(`expired-ward-${suffix}`).digest("hex"),
        status: "active",
      })
      .returning({ id: qrCredentials.id });
    const [expiredRequest] = await db
      .insert(accessRequests)
      .values({
        patientId: expiredWard.id,
        clinicianUserId,
        sourceQrCredentialId: expiredCredential.id,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    await db.insert(guardianships).values({
      guardianPatientId,
      wardPatientId: expiredWard.id,
      relationship: "mother",
      verificationStatus: "verified",
      validUntil: new Date(Date.now() - 1000),
    });
    const guardian: AuthenticatedUser = {
      id: guardianUserId,
      sub: `approval-guardian-${suffix}`,
      role: "guardian",
    };

    await expect(
      service.approve(expiredRequest.id, guardian, audit.hashIp("127.0.0.1"))
    ).rejects.toThrow(/not authorized/i);

    await db.delete(accessRequests).where(eq(accessRequests.id, expiredRequest.id));
    await db.delete(guardianships).where(eq(guardianships.wardPatientId, expiredWard.id));
    await db.delete(qrCredentials).where(eq(qrCredentials.id, expiredCredential.id));
    await db.delete(patients).where(eq(patients.id, expiredWard.id));
    await db.delete(users).where(eq(users.id, unrelatedUser.id));
  });

  it("binds an OTP to its request, patient, and requesting clinician", async () => {
    const patientUser: AuthenticatedUser = {
      id: patientUserId,
      sub: `approval-patient-${suffix}`,
      role: "patient",
    };
    const [otpRequest] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    const [anotherRequest] = await db
      .insert(accessRequests)
      .values({
        patientId: wardPatientId,
        clinicianUserId: clinicianUserId,
        sourceQrCredentialId: wardCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    const challenge = await service.issueApprovalOtp(
      otpRequest.id,
      patientUser,
      audit.hashIp("127.0.0.1")
    );
    const differentClinician: AuthenticatedUser = {
      id: otherClinicianUserId,
      sub: `approval-other-clinician-${suffix}`,
      role: "clinician",
      isVerified: true,
    };
    await expect(
      service.approveWithOtp(
        otpRequest.id,
        challenge.code,
        differentClinician,
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/only the clinician who requested/i);
    await expect(
      service.approveWithOtp(
        anotherRequest.id,
        challenge.code,
        {
          id: clinicianUserId,
          sub: `approval-clinician-${suffix}`,
          role: "clinician",
          isVerified: true,
        },
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/invalid or expired/i);

    await db
      .update(accessRequests)
      .set({ patientId: wardPatientId })
      .where(eq(accessRequests.id, otpRequest.id));
    await expect(
      service.approveWithOtp(
        otpRequest.id,
        challenge.code,
        {
          id: clinicianUserId,
          sub: `approval-clinician-${suffix}`,
          role: "clinician",
          isVerified: true,
        },
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/does not match this request/i);
    await db
      .update(accessRequests)
      .set({ patientId })
      .where(eq(accessRequests.id, otpRequest.id));
    await db.delete(accessRequests).where(eq(accessRequests.id, otpRequest.id));
    await db.delete(accessRequests).where(eq(accessRequests.id, anotherRequest.id));
  });

  it("expires OTPs, locks after five wrong codes, and rate-limits issuance", async () => {
    const patientUser: AuthenticatedUser = {
      id: patientUserId,
      sub: `approval-patient-${suffix}`,
      role: "patient",
    };
    const [expiringRequest] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    const expiredCode = await service.issueApprovalOtp(
      expiringRequest.id,
      patientUser,
      audit.hashIp("127.0.0.1")
    );
    await redisClient.expire(`access:otp:challenge:${expiringRequest.id}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(
      service.approveWithOtp(
        expiringRequest.id,
        expiredCode.code,
        {
          id: clinicianUserId,
          sub: `approval-clinician-${suffix}`,
          role: "clinician",
          isVerified: true,
        },
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/invalid or expired/i);

    const [lockedRequest] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    const lockedCode = await service.issueApprovalOtp(
      lockedRequest.id,
      patientUser,
      audit.hashIp("127.0.0.1")
    );
    const clinician: AuthenticatedUser = {
      id: clinicianUserId,
      sub: `approval-clinician-${suffix}`,
      role: "clinician",
      isVerified: true,
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.approveWithOtp(
          lockedRequest.id,
          "000000",
          clinician,
          audit.hashIp("127.0.0.1")
        )
      ).rejects.toThrow(/invalid or expired/i);
    }
    await expect(
      service.approveWithOtp(
        lockedRequest.id,
        lockedCode.code,
        clinician,
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/invalid or expired/i);

    const [limitedRequest] = await db
      .insert(accessRequests)
      .values({
        patientId,
        clinicianUserId,
        sourceQrCredentialId: patientCredentialId,
        purpose: "clinical-care",
        scope: ["timeline"],
      })
      .returning({ id: accessRequests.id });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.issueApprovalOtp(
        limitedRequest.id,
        patientUser,
        audit.hashIp("127.0.0.1")
      );
    }
    await expect(
      service.issueApprovalOtp(
        limitedRequest.id,
        patientUser,
        audit.hashIp("127.0.0.1")
      )
    ).rejects.toThrow(/temporarily unavailable/i);

    await db
      .delete(accessRequests)
      .where(inArray(accessRequests.id, [expiringRequest.id, lockedRequest.id, limitedRequest.id]));
  });
});
