import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { accessRequests, consents, qrCredentials } from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { QrResolutionService } from "../qr/qr-resolution.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type { CreateAccessRequestInput } from "./access-request.schema.js";

@Injectable()
export class AccessRequestService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(QrResolutionService) private readonly qrResolution: QrResolutionService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService
  ) {}

  async create(
    user: AuthenticatedUser,
    input: CreateAccessRequestInput,
    ipHash: string
  ): Promise<{ requestId: string; status: "pending" }> {
    if (user.role !== "clinician" || user.isVerified !== true) {
      throw new ForbiddenException("Verified clinician access is required");
    }

    const credentialId = await this.qrResolution.consumeRequestResolution(
      input.resolutionId
    );
    if (!credentialId) {
      throw new BadRequestException("QR request is expired or unavailable");
    }

    const result = await db.transaction(async (transaction) => {
      const [credential] = await transaction
        .select({ id: qrCredentials.id, patientId: qrCredentials.patientId })
        .from(qrCredentials)
        .where(
          and(
            eq(qrCredentials.id, credentialId),
            eq(qrCredentials.status, "active")
          )
        )
        .limit(1)
        .for("share");
      if (!credential) {
        throw new BadRequestException("QR request is expired or unavailable");
      }

      const [created] = await transaction
        .insert(accessRequests)
        .values({
          patientId: credential.patientId,
          clinicianUserId: user.id,
          sourceQrCredentialId: credential.id,
          purpose: input.purpose,
          scope: [...input.scope],
        })
        .returning({ id: accessRequests.id });

      await this.audit.logInTransaction(
        {
          actorId: user.id,
          actorRole: user.role,
          action: "ACCESS_REQUEST_CREATED",
          resourceType: "access_request",
          resourceId: created.id,
          outcome: "SUCCESS",
          ipHash,
        },
        transaction
      );
      const notificationDeliveries =
        await this.notifications.recordForPatientAndGuardians(
          credential.patientId,
          "ACCESS_REQUESTED",
          created.id,
          transaction
        );

      return { requestId: created.id, notificationDeliveries };
    });
    await this.notifications.deliverDevelopmentEmails(
      result.notificationDeliveries
    );

    return { requestId: result.requestId, status: "pending" };
  }

  async getStatus(
    user: AuthenticatedUser,
    requestId: string
  ): Promise<{
    status: "pending" | "denied" | "cancelled" | "revoked" | "expired" | "active";
    scope?: string[];
    purpose?: string;
    expiresAt?: string;
  }> {
    if (user.role !== "clinician" || user.isVerified !== true) {
      throw new ForbiddenException("Verified clinician access is required");
    }

    const [request] = await db
      .select({
        clinicianUserId: accessRequests.clinicianUserId,
        status: accessRequests.status,
      })
      .from(accessRequests)
      .where(eq(accessRequests.id, requestId))
      .limit(1);
    if (!request || request.clinicianUserId !== user.id) {
      throw new NotFoundException("Access request not found");
    }
    if (request.status !== "approved") {
      return { status: request.status };
    }

    const [consent] = await db
      .select({
        status: consents.status,
        scope: consents.scope,
        purpose: consents.purpose,
        expiresAt: consents.expiresAt,
      })
      .from(consents)
      .where(eq(consents.accessRequestId, requestId))
      .limit(1);
    if (!consent) return { status: "expired" };
    if (consent.status !== "active") return { status: consent.status };
    if (consent.expiresAt <= new Date()) return { status: "expired" };

    return {
      status: "active",
      scope: [...consent.scope],
      purpose: consent.purpose,
      expiresAt: consent.expiresAt.toISOString(),
    };
  }
}
