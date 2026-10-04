import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Redis } from "ioredis";
import { z } from "zod";
import { db } from "../../database/index.js";
import {
  accessRequests,
  auditEvents,
  clinicians,
  consents,
  documents,
  guardianships,
  patients,
} from "../../database/schema.js";
import { env } from "../../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import {
  findGuardianWardPatientIds,
  findPatientOwnerByUserId,
} from "../auth/patient-access.js";
import { QR_REDIS_CLIENT } from "../qr/qr-resolution.service.js";

const OTP_TTL_SECONDS = 120;
const OTP_ISSUE_LIMIT_PER_HOUR = 5;
const OTP_FAILURE_LIMIT = 5;
const approvalOtpSchema = z.object({
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicianUserId: z.string().uuid(),
  approverUserId: z.string().uuid(),
  approverRole: z.enum(["patient", "guardian"]),
});

const guardianPatients = alias(patients, "approval_guardian_patient");
const wardPatients = alias(patients, "approval_ward_patient");
type SelectExecutor = Pick<typeof db, "select">;

@Injectable()
export class AccessRequestApprovalService {
  constructor(
    private readonly audit: AuditService,
    @Inject(QR_REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async listPending(user: AuthenticatedUser) {
    let patientIds: string[];
    let wards: { id: string; label: string }[];
    if (user.role === "patient") {
      const patient = await findPatientOwnerByUserId(user.id);
      patientIds = patient ? [patient.id] : [];
      wards = patient ? [{ id: patient.id, label: "Your record" }] : [];
    } else if (user.role === "guardian") {
      wards = await db
        .select({ id: wardPatients.id, label: wardPatients.fullName })
        .from(guardianships)
        .innerJoin(
          guardianPatients,
          eq(guardianships.guardianPatientId, guardianPatients.id)
        )
        .innerJoin(wardPatients, eq(guardianships.wardPatientId, wardPatients.id))
        .where(
          and(
            eq(guardianPatients.userId, user.id),
            eq(guardianships.verificationStatus, "verified"),
            or(isNull(guardianships.validUntil), gt(guardianships.validUntil, new Date()))
          )
        );
      patientIds = wards.map(({ id }) => id);
    } else {
      throw new ForbiddenException("Patient or guardian session is required");
    }

    if (patientIds.length === 0) {
      return {
        wards,
        requests: [],
        consentDurationHours: env.ACCESS_CONSENT_TTL_HOURS,
      };
    }
    const requests = await db
      .select({
        id: accessRequests.id,
        patientId: accessRequests.patientId,
        patientLabel: patients.fullName,
        clinicianName: clinicians.fullName,
        purpose: accessRequests.purpose,
        scope: accessRequests.scope,
        createdAt: accessRequests.createdAt,
      })
      .from(accessRequests)
      .innerJoin(
        clinicians,
        eq(accessRequests.clinicianUserId, clinicians.userId)
      )
      .innerJoin(patients, eq(accessRequests.patientId, patients.id))
      .where(
        and(
          inArray(accessRequests.patientId, patientIds),
          eq(accessRequests.status, "pending")
        )
      )
      .orderBy(accessRequests.createdAt);
    return {
      wards,
      requests,
      consentDurationHours: env.ACCESS_CONSENT_TTL_HOURS,
    };
  }

  async listHistory(user: AuthenticatedUser) {
    let patientIds: string[];
    if (user.role === "patient") {
      const patient = await findPatientOwnerByUserId(user.id);
      patientIds = patient ? [patient.id] : [];
    } else if (user.role === "guardian") {
      patientIds = await findGuardianWardPatientIds(user.id);
    } else {
      throw new ForbiddenException("Patient or guardian session is required");
    }
    if (patientIds.length === 0) return { requests: [], reads: [] };

    const requests = await db
      .select({
        id: accessRequests.id,
        patientId: accessRequests.patientId,
        patientLabel: patients.fullName,
        clinicianName: clinicians.fullName,
        purpose: accessRequests.purpose,
        scope: accessRequests.scope,
        requestStatus: accessRequests.status,
        requestedAt: accessRequests.createdAt,
        consentId: consents.id,
        consentStatus: consents.status,
        consentExpiresAt: consents.expiresAt,
        consentRevokedAt: consents.revokedAt,
      })
      .from(accessRequests)
      .innerJoin(patients, eq(accessRequests.patientId, patients.id))
      .innerJoin(
        clinicians,
        eq(accessRequests.clinicianUserId, clinicians.userId)
      )
      .leftJoin(consents, eq(consents.accessRequestId, accessRequests.id))
      .where(inArray(accessRequests.patientId, patientIds))
      .orderBy(desc(accessRequests.createdAt));
    const reads = await db
      .select({
        id: auditEvents.id,
        clinicianName: clinicians.fullName,
        documentType: documents.documentType,
        viewedAt: auditEvents.timestamp,
      })
      .from(auditEvents)
      .innerJoin(
        documents,
        sql`${auditEvents.resourceId} = ${documents.id}::text`
      )
      .innerJoin(clinicians, eq(auditEvents.actorId, clinicians.userId))
      .where(
        and(
          eq(auditEvents.action, "DOCUMENT_VIEWED"),
          eq(auditEvents.actorRole, "clinician"),
          inArray(documents.patientId, patientIds)
        )
      )
      .orderBy(desc(auditEvents.timestamp));
    return { requests, reads };
  }

  async approve(
    requestId: string,
    user: AuthenticatedUser,
    ipHash: string
  ): Promise<{ status: "approved" }> {
    await this.decide(
      requestId,
      user.id,
      user.role,
      "approved",
      "ACCESS_REQUEST_APPROVED",
      ipHash
    );
    return { status: "approved" };
  }

  async deny(
    requestId: string,
    user: AuthenticatedUser,
    ipHash: string
  ): Promise<{ status: "denied" }> {
    await this.decide(
      requestId,
      user.id,
      user.role,
      "denied",
      "ACCESS_REQUEST_DENIED",
      ipHash
    );
    return { status: "denied" };
  }

  async issueApprovalOtp(
    requestId: string,
    user: AuthenticatedUser,
    ipHash: string
  ): Promise<{ code: string; expiresAt: Date }> {
    if (user.role !== "patient" && user.role !== "guardian") {
      throw new ForbiddenException("Patient or guardian approval is required");
    }

    const [request] = await db
      .select({
        id: accessRequests.id,
        patientId: accessRequests.patientId,
        clinicianUserId: accessRequests.clinicianUserId,
        status: accessRequests.status,
      })
      .from(accessRequests)
      .where(eq(accessRequests.id, requestId))
      .limit(1);
    if (!request || request.status !== "pending") {
      throw new BadRequestException("Access request is no longer pending");
    }
    await assertApprovalAuthority(db, request.patientId, user.id, user.role);

    const issueLimitKey = `access:otp:issue:${requestId}:${user.id}`;
    const issueCount = await this.redis.incr(issueLimitKey);
    if (issueCount === 1) await this.redis.expire(issueLimitKey, 3600);
    if (issueCount > OTP_ISSUE_LIMIT_PER_HOUR) {
      throw new HttpException(
        "Approval code issuance is temporarily unavailable",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = {
      codeHash: hashOtp(requestId, code),
      requestId,
      patientId: request.patientId,
      clinicianUserId: request.clinicianUserId,
      approverUserId: user.id,
      approverRole: user.role,
    };
    const otpKey = `access:otp:challenge:${requestId}`;
    await this.redis.set(otpKey, JSON.stringify(challenge), "EX", OTP_TTL_SECONDS);

    try {
      const integrityHash = await this.audit.logInTransaction({
        actorId: user.id,
        actorRole: user.role,
        action: "ACCESS_REQUEST_OTP_ISSUED",
        resourceType: "access_request",
        resourceId: requestId,
        outcome: "SUCCESS",
        ipHash,
      });
      this.audit.commitTransactionHash(integrityHash);
    } catch (error) {
      await this.redis.del(otpKey);
      throw error;
    }

    return {
      code,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    };
  }

  async approveWithOtp(
    requestId: string,
    code: string,
    clinician: AuthenticatedUser,
    ipHash: string
  ): Promise<{ status: "approved" }> {
    if (clinician.role !== "clinician" || clinician.isVerified !== true) {
      throw new ForbiddenException("Verified clinician access is required");
    }

    const otpKey = `access:otp:challenge:${requestId}`;
    const stored = await this.redis.get(otpKey);
    if (!stored) throw new BadRequestException("Approval code is invalid or expired");

    let storedValue: unknown;
    try {
      storedValue = JSON.parse(stored) as unknown;
    } catch {
      await this.redis.del(otpKey);
      throw new BadRequestException("Approval code is invalid or expired");
    }
    const parsed = approvalOtpSchema.safeParse(storedValue);
    if (!parsed.success) {
      await this.redis.del(otpKey);
      throw new BadRequestException("Approval code is invalid or expired");
    }
    if (
      parsed.data.requestId !== requestId ||
      parsed.data.clinicianUserId !== clinician.id
    ) {
      throw new ForbiddenException(
        "Only the clinician who requested access can confirm this code"
      );
    }

    const expectedHash = Buffer.from(parsed.data.codeHash);
    const actualHash = Buffer.from(hashOtp(requestId, code));
    if (!timingSafeEqual(expectedHash, actualHash)) {
      const attemptsKey = `access:otp:attempts:${requestId}`;
      const attempts = await this.redis.incr(attemptsKey);
      if (attempts === 1) await this.redis.expire(attemptsKey, OTP_TTL_SECONDS);
      if (attempts >= OTP_FAILURE_LIMIT) await this.redis.del(otpKey);
      throw new BadRequestException("Approval code is invalid or expired");
    }

    const consumed = await this.redis.getdel(otpKey);
    if (consumed !== stored) {
      throw new BadRequestException("Approval code is invalid or expired");
    }

    await this.decide(
      requestId,
      parsed.data.approverUserId,
      parsed.data.approverRole,
      "approved",
      "ACCESS_REQUEST_OTP_APPROVED",
      ipHash,
      {
        patientId: parsed.data.patientId,
        clinicianUserId: parsed.data.clinicianUserId,
      }
    );
    return { status: "approved" };
  }

  private async decide(
    requestId: string,
    approverUserId: string,
    approverRole: string,
    status: "approved" | "denied",
    action: "ACCESS_REQUEST_APPROVED" | "ACCESS_REQUEST_DENIED" | "ACCESS_REQUEST_OTP_APPROVED",
    ipHash: string,
    expectedRequest?: { patientId: string; clinicianUserId: string }
  ): Promise<void> {
    if (approverRole !== "patient" && approverRole !== "guardian") {
      throw new ForbiddenException("Patient or guardian approval is required");
    }

    const integrityHash = await db.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          id: accessRequests.id,
          patientId: accessRequests.patientId,
          clinicianUserId: accessRequests.clinicianUserId,
          purpose: accessRequests.purpose,
          scope: accessRequests.scope,
          status: accessRequests.status,
        })
        .from(accessRequests)
        .where(eq(accessRequests.id, requestId))
        .limit(1)
        .for("update");
      if (!request || request.status !== "pending") {
        throw new BadRequestException("Access request is no longer pending");
      }
      if (
        expectedRequest &&
        (request.patientId !== expectedRequest.patientId ||
          request.clinicianUserId !== expectedRequest.clinicianUserId)
      ) {
        throw new ForbiddenException("Approval code does not match this request");
      }

      await assertApprovalAuthority(
        transaction,
        request.patientId,
        approverUserId,
        approverRole
      );

      await transaction
        .update(accessRequests)
        .set({
          status,
          decidedAt: new Date(),
          decidedByUserId: approverUserId,
        })
        .where(eq(accessRequests.id, request.id));

      if (status === "approved") {
        const expiresAt = new Date(
          Date.now() + env.ACCESS_CONSENT_TTL_HOURS * 60 * 60 * 1000
        );
        await transaction.insert(consents).values({
          accessRequestId: request.id,
          patientId: request.patientId,
          granteeUserId: request.clinicianUserId,
          purpose: request.purpose,
          scope: request.scope,
          status: "active",
          expiresAt,
        });
      }

      return this.audit.logInTransaction(
        {
          actorId: approverUserId,
          actorRole: approverRole,
          action,
          resourceType: "access_request",
          resourceId: request.id,
          outcome: "SUCCESS",
          ipHash,
        },
        transaction
      );
    });
    this.audit.commitTransactionHash(integrityHash);
  }
}

async function assertApprovalAuthority(
  executor: SelectExecutor,
  patientId: string,
  userId: string,
  role: string
): Promise<void> {
  if (role === "patient") {
    const [owner] = await executor
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
      .limit(1);
    if (owner) return;
  } else if (role === "guardian") {
    const [relationship] = await executor
      .select({ id: guardianships.id })
      .from(guardianships)
      .innerJoin(
        guardianPatients,
        eq(guardianships.guardianPatientId, guardianPatients.id)
      )
      .innerJoin(wardPatients, eq(guardianships.wardPatientId, wardPatients.id))
      .where(
        and(
          eq(guardianPatients.userId, userId),
          eq(wardPatients.id, patientId),
          eq(guardianships.verificationStatus, "verified"),
          or(isNull(guardianships.validUntil), gt(guardianships.validUntil, new Date()))
        )
      )
      .limit(1);
    if (relationship) return;
  }

  throw new ForbiddenException("Approval is not authorized for this patient");
}

function hashOtp(requestId: string, code: string): string {
  return createHmac("sha256", env.OTP_HMAC_SECRET)
    .update(`${requestId}:${code}`)
    .digest("hex");
}
