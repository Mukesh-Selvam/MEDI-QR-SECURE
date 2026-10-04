import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { accessRequests, qrCredentials } from "../../database/schema.js";
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
}
