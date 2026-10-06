import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../database/index.js";
import {
  documents,
  emergencyAccessRequests,
  emergencyAccessReviews,
  emergencyProfiles,
  facilities,
  facilityStaffAffiliations,
  guardianships,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { QrResolutionService } from "../qr/qr-resolution.service.js";
import { VaultCryptoService } from "../vault/crypto/vault-crypto.service.js";
import type { UpdateEmergencyDocumentVisibilityInput } from "./emergency-document-visibility.schema.js";
import { emergencyProfileSchema } from "./emergency-profile.schema.js";
import type { CreateEmergencyAccessRequestInput } from "./emergency-access.schema.js";

const GRANT_LIFETIME_MS = 30 * 60 * 1000;
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRESCRIPTION_SUMMARY_LIMIT = 5;
const MINIMUM_ACTIVE_FACILITY_ADMINS = 2;
const EMERGENCY_ACCESS_UNAVAILABLE = "Emergency access unavailable.";
const EMERGENCY_DOCUMENT_VISIBILITY_UNAVAILABLE =
  "Emergency document visibility unavailable.";
const guardianPatients = alias(
  patients,
  "emergency_visibility_guardian_patient",
);
type EmergencyStaffRole = "emergency-department-staff" | "pharmacy-staff";

function isEmergencyStaffRole(role: string): role is EmergencyStaffRole {
  return role === "emergency-department-staff" || role === "pharmacy-staff";
}

type EmergencyAudit = Pick<AuditService, "hashIp" | "logInTransaction">;
type EmergencyCrypto = Pick<VaultCryptoService, "decrypt">;
type EmergencyNotifications = Pick<
  NotificationsService,
  "recordForPatientAndGuardians" | "queueEmergencyEmailOutbox"
>;
type EmergencyAccessSummary =
  | {
      requestId: string;
      expiresAt: string;
      bloodGroup: string;
      allergies: string[];
      emergencyContacts: {
        name: string;
        relationship: string;
        phone: string;
      }[];
      prescriptions: { type: "prescription"; date: string | null }[];
    }
  | {
      requestId: string;
      expiresAt: string;
      allergies: string[];
    };

@Injectable()
export class EmergencyAccessService {
  constructor(
    @Inject(AuditService) private readonly audit: EmergencyAudit,
    @Inject(QrResolutionService)
    private readonly qrResolution: QrResolutionService,
    @Inject(NotificationsService)
    private readonly notifications: EmergencyNotifications,
    @Inject(VaultCryptoService)
    private readonly crypto: EmergencyCrypto,
  ) {}

  async updatePrescriptionVisibility(
    documentId: string,
    input: UpdateEmergencyDocumentVisibilityInput,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ): Promise<{ documentId: string; emergencyVisible: boolean }> {
    if (actor.role !== "patient" && actor.role !== "guardian") {
      throw new ForbiddenException(EMERGENCY_DOCUMENT_VISIBILITY_UNAVAILABLE);
    }

    return db.transaction(async (transaction) => {
      const [document] = await transaction
        .select({
          id: documents.id,
          patientId: documents.patientId,
          patientUserId: patients.userId,
          documentType: documents.documentType,
          status: documents.status,
          deletedAt: documents.deletedAt,
          emergencyVisible: documents.emergencyVisible,
        })
        .from(documents)
        .innerJoin(patients, eq(documents.patientId, patients.id))
        .where(eq(documents.id, documentId))
        .for("update")
        .limit(1);
      if (
        !document ||
        document.deletedAt !== null ||
        document.documentType !== "prescription" ||
        document.status !== "ready"
      ) {
        throw new ForbiddenException(EMERGENCY_DOCUMENT_VISIBILITY_UNAVAILABLE);
      }

      if (actor.role === "patient") {
        if (document.patientUserId !== actor.id) {
          throw new ForbiddenException(
            EMERGENCY_DOCUMENT_VISIBILITY_UNAVAILABLE,
          );
        }
      } else {
        const [relationship] = await transaction
          .select({ id: guardianships.id })
          .from(guardianships)
          .innerJoin(
            guardianPatients,
            eq(guardianships.guardianPatientId, guardianPatients.id),
          )
          .where(
            and(
              eq(guardianPatients.userId, actor.id),
              eq(guardianships.wardPatientId, document.patientId),
              eq(guardianships.verificationStatus, "verified"),
              or(
                isNull(guardianships.validUntil),
                gt(guardianships.validUntil, new Date()),
              ),
            ),
          )
          .for("share")
          .limit(1);
        if (!relationship) {
          throw new ForbiddenException(
            EMERGENCY_DOCUMENT_VISIBILITY_UNAVAILABLE,
          );
        }
      }

      if (document.emergencyVisible === input.emergencyVisible) {
        return {
          documentId: document.id,
          emergencyVisible: document.emergencyVisible,
        };
      }

      const [updated] = await transaction
        .update(documents)
        .set({
          emergencyVisible: input.emergencyVisible,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id))
        .returning({
          id: documents.id,
          emergencyVisible: documents.emergencyVisible,
        });
      if (!updated) {
        throw new Error(
          "Emergency document visibility update returned no row.",
        );
      }

      await this.audit.logInTransaction(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: input.emergencyVisible
            ? "EMERGENCY_DOCUMENT_VISIBLE_FALSE_TO_TRUE"
            : "EMERGENCY_DOCUMENT_VISIBLE_TRUE_TO_FALSE",
          resourceType: "document",
          resourceId: updated.id,
          outcome: "SUCCESS",
          ipHash: this.audit.hashIp(ip),
          userAgent,
        },
        transaction,
      );

      return {
        documentId: updated.id,
        emergencyVisible: updated.emergencyVisible,
      };
    });
  }

  async createRequest(
    facilityId: string,
    input: CreateEmergencyAccessRequestInput,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ): Promise<{
    requestId: string;
    status: "granted";
    expiresAt: string;
  }> {
    const actorRole = actor.role;
    if (!isEmergencyStaffRole(actorRole)) {
      throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
    }

    const expectedFacilityType =
      actorRole === "emergency-department-staff"
        ? "hospital-emergency-department"
        : "pharmacy";

    const credentialId = await this.qrResolution.consumeRequestResolution(
      input.resolutionId,
    );
    if (!credentialId) {
      throw new BadRequestException(EMERGENCY_ACCESS_UNAVAILABLE);
    }

    const result = await db.transaction(async (transaction) => {
      const [facility] = await transaction
        .select({
          id: facilities.id,
          facilityType: facilities.facilityType,
          verificationStatus: facilities.verificationStatus,
        })
        .from(facilities)
        .innerJoin(
          facilityStaffAffiliations,
          and(
            eq(facilityStaffAffiliations.facilityId, facilities.id),
            eq(facilityStaffAffiliations.userId, actor.id),
            eq(facilityStaffAffiliations.role, actorRole),
            eq(facilityStaffAffiliations.status, "active"),
          ),
        )
        .where(eq(facilities.id, facilityId))
        .for("update")
        .limit(1);
      if (
        !facility ||
        facility.facilityType !== expectedFacilityType ||
        facility.verificationStatus !== "verified"
      ) {
        throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
      }

      const [activeFacilityAdmins] = await transaction
        .select({ count: count() })
        .from(facilityStaffAffiliations)
        .innerJoin(users, eq(facilityStaffAffiliations.userId, users.id))
        .where(
          and(
            eq(facilityStaffAffiliations.facilityId, facility.id),
            eq(facilityStaffAffiliations.role, "facility-admin"),
            eq(facilityStaffAffiliations.status, "active"),
            eq(users.status, "active"),
          ),
        );
      if (activeFacilityAdmins.count < MINIMUM_ACTIVE_FACILITY_ADMINS) {
        throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
      }

      const [credential] = await transaction
        .select({
          id: qrCredentials.id,
          patientId: qrCredentials.patientId,
        })
        .from(qrCredentials)
        .where(
          and(
            eq(qrCredentials.id, credentialId),
            eq(qrCredentials.status, "active"),
          ),
        )
        .for("share")
        .limit(1);
      if (!credential) {
        throw new BadRequestException(EMERGENCY_ACCESS_UNAVAILABLE);
      }

      const [patient] = await transaction
        .select({ id: patients.id, userId: patients.userId })
        .from(patients)
        .where(eq(patients.id, credential.patientId))
        .for("update")
        .limit(1);
      if (!patient) {
        throw new BadRequestException(EMERGENCY_ACCESS_UNAVAILABLE);
      }

      const [profile] = await transaction
        .select({ enabled: emergencyProfiles.enabled })
        .from(emergencyProfiles)
        .where(eq(emergencyProfiles.patientId, patient.id))
        .for("update")
        .limit(1);
      const enabled = profile?.enabled === true;
      const grantedAt = new Date();
      const expiresAt = new Date(grantedAt.getTime() + GRANT_LIFETIME_MS);
      const [created] = await transaction
        .insert(emergencyAccessRequests)
        .values({
          patientId: patient.id,
          requesterUserId: actor.id,
          facilityId: facility.id,
          providerType: facility.facilityType,
          reasonCode: input.reasonCode,
          status: enabled ? "granted" : "denied",
          ...(enabled ? { grantedAt, expiresAt } : {}),
        })
        .returning({
          id: emergencyAccessRequests.id,
          status: emergencyAccessRequests.status,
        });
      if (!created) {
        throw new Error("Emergency access request insert returned no record.");
      }

      if (!enabled) {
        await this.audit.logInTransaction(
          {
            actorId: actor.id,
            actorRole,
            action: "EMERGENCY_ACCESS_REQUEST_DENIED",
            resourceType: "emergency_access_request",
            resourceId: created.id,
            outcome: "DENIED",
            ipHash: this.audit.hashIp(ip),
            userAgent,
          },
          transaction,
        );
        return { requestId: created.id, denied: true as const };
      }

      await this.audit.logInTransaction(
        {
          actorId: actor.id,
          actorRole,
          action: "EMERGENCY_ACCESS_REQUEST_GRANTED",
          resourceType: "emergency_access_request",
          resourceId: created.id,
          outcome: "SUCCESS",
          ipHash: this.audit.hashIp(ip),
          userAgent,
        },
        transaction,
      );

      const notificationDeliveries =
        await this.notifications.recordForPatientAndGuardians(
          patient.id,
          "EMERGENCY_ACCESS_GRANTED",
          created.id,
          transaction,
        );
      const queuedEmailRecipientIds =
        await this.notifications.queueEmergencyEmailOutbox(
          notificationDeliveries,
          transaction,
        );
      const notificationChannelMissing = !queuedEmailRecipientIds.includes(
        patient.userId,
      );
      const [updated] = await transaction
        .update(emergencyAccessRequests)
        .set({
          notificationChannelMissing,
          priorityReview: notificationChannelMissing,
        })
        .where(eq(emergencyAccessRequests.id, created.id))
        .returning({ id: emergencyAccessRequests.id });
      if (!updated) {
        throw new Error(
          "Emergency access notification state update returned no record.",
        );
      }

      await transaction.insert(emergencyAccessReviews).values({
        requestId: created.id,
        reviewDueAt: new Date(grantedAt.getTime() + REVIEW_WINDOW_MS),
      });

      return {
        requestId: created.id,
        expiresAt,
        denied: false as const,
      };
    });

    if (result.denied) {
      throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
    }

    return {
      requestId: result.requestId,
      status: "granted",
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  async readSummary(
    requestId: string,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ): Promise<EmergencyAccessSummary> {
    const actorRole = actor.role;
    if (!isEmergencyStaffRole(actorRole)) {
      throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
    }

    const [requestHint] = await db
      .select({ patientId: emergencyAccessRequests.patientId })
      .from(emergencyAccessRequests)
      .where(eq(emergencyAccessRequests.id, requestId))
      .limit(1);
    if (!requestHint) {
      throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
    }

    let summary: EmergencyAccessSummary | undefined;
    let unavailable = false;
    await db.transaction(async (transaction) => {
      const [patient] = await transaction
        .select({ id: patients.id, userId: patients.userId })
        .from(patients)
        .where(eq(patients.id, requestHint.patientId))
        .for("update")
        .limit(1);
      if (!patient) {
        unavailable = true;
        return;
      }

      const [grant] = await transaction
        .select({
          id: emergencyAccessRequests.id,
          patientId: emergencyAccessRequests.patientId,
          requesterUserId: emergencyAccessRequests.requesterUserId,
          facilityId: emergencyAccessRequests.facilityId,
          providerType: emergencyAccessRequests.providerType,
          status: emergencyAccessRequests.status,
          expiresAt: emergencyAccessRequests.expiresAt,
          facilityStatus: facilities.verificationStatus,
        })
        .from(emergencyAccessRequests)
        .innerJoin(
          facilities,
          eq(emergencyAccessRequests.facilityId, facilities.id),
        )
        .where(eq(emergencyAccessRequests.id, requestId))
        .for("update")
        .limit(1);
      const [profile] = await transaction
        .select()
        .from(emergencyProfiles)
        .where(eq(emergencyProfiles.patientId, patient.id))
        .for("update")
        .limit(1);
      if (
        !grant ||
        grant.patientId !== patient.id ||
        grant.requesterUserId !== actor.id ||
        grant.providerType !==
          (actorRole === "emergency-department-staff"
            ? "hospital-emergency-department"
            : "pharmacy") ||
        grant.facilityStatus !== "verified" ||
        !profile?.enabled
      ) {
        unavailable = true;
        return;
      }

      const [affiliation] = await transaction
        .select({ id: facilityStaffAffiliations.id })
        .from(facilityStaffAffiliations)
        .where(
          and(
            eq(facilityStaffAffiliations.facilityId, grant.facilityId),
            eq(facilityStaffAffiliations.userId, actor.id),
            eq(facilityStaffAffiliations.role, actorRole),
            eq(facilityStaffAffiliations.status, "active"),
          ),
        )
        .limit(1);
      if (!affiliation) {
        unavailable = true;
        return;
      }

      const now = new Date();
      if (
        grant.status !== "granted" ||
        !grant.expiresAt ||
        grant.expiresAt <= now
      ) {
        if (
          grant.status === "granted" &&
          grant.expiresAt &&
          grant.expiresAt <= now
        ) {
          await transaction
            .update(emergencyAccessRequests)
            .set({ status: "expired" })
            .where(eq(emergencyAccessRequests.id, grant.id));
        }
        unavailable = true;
        return;
      }

      const plaintext = await this.crypto.decrypt({
        ciphertext: Buffer.from(profile.encryptedPayload, "base64"),
        wrappedDek: profile.wrappedDek,
        kmsKeyId: profile.kmsKeyId,
        iv: profile.iv,
        authTag: profile.authTag,
        sha256Plaintext: profile.sha256Plaintext,
      });
      try {
        const parsed = emergencyProfileSchema.safeParse({
          ...JSON.parse(plaintext.toString("utf8")),
          enabled: profile.enabled,
        });
        if (!parsed.success) {
          throw new Error("Stored emergency profile failed validation.");
        }

        let prescriptions: { type: "prescription"; date: string | null }[] = [];
        if (grant.providerType === "hospital-emergency-department") {
          const eligibleDocuments = await transaction
            .select({
              documentDate: documents.documentDate,
            })
            .from(documents)
            .where(
              and(
                eq(documents.patientId, patient.id),
                eq(documents.emergencyVisible, true),
                eq(documents.documentType, "prescription"),
                eq(documents.status, "ready"),
              ),
            )
            .orderBy(
              desc(
                sql`coalesce(${documents.documentDate}, ${documents.createdAt})`,
              ),
            )
            .limit(PRESCRIPTION_SUMMARY_LIMIT);
          prescriptions = eligibleDocuments.map(({ documentDate }) => ({
            type: "prescription",
            date: documentDate?.toISOString().slice(0, 10) ?? null,
          }));
        }

        await this.audit.logInTransaction(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: "EMERGENCY_SUMMARY_READ",
            resourceType: "emergency_access_request",
            resourceId: grant.id,
            outcome: "SUCCESS",
            ipHash: this.audit.hashIp(ip),
            userAgent,
          },
          transaction,
        );

        summary =
          grant.providerType === "hospital-emergency-department"
            ? {
                requestId: grant.id,
                expiresAt: grant.expiresAt.toISOString(),
                bloodGroup: parsed.data.bloodGroup,
                allergies: parsed.data.allergies,
                emergencyContacts: parsed.data.emergencyContacts,
                prescriptions,
              }
            : {
                requestId: grant.id,
                expiresAt: grant.expiresAt.toISOString(),
                allergies: parsed.data.allergies,
              };
      } finally {
        plaintext.fill(0);
      }
    });

    if (unavailable || !summary) {
      throw new ForbiddenException(EMERGENCY_ACCESS_UNAVAILABLE);
    }
    return summary;
  }
}
