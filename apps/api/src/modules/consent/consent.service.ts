import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../database/index.js";
import { consents } from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";

@Injectable()
export class ConsentService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService
  ) {}

  async revoke(
    consentId: string,
    user: AuthenticatedUser,
    ipHash: string
  ): Promise<{ status: "revoked" }> {
    const { notificationDeliveries } = await db.transaction(async (transaction) => {
      const [consent] = await transaction
        .select({
          id: consents.id,
          patientId: consents.patientId,
          accessRequestId: consents.accessRequestId,
          status: consents.status,
          expiresAt: consents.expiresAt,
        })
        .from(consents)
        .where(eq(consents.id, consentId))
        .limit(1)
        .for("update");
      if (!consent) throw new NotFoundException("Consent not found");
      if (consent.status !== "active" || consent.expiresAt <= new Date()) {
        throw new ConflictException("Consent is no longer active");
      }

      await transaction
        .update(consents)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(consents.id, consentId),
            eq(consents.status, "active"),
            gt(consents.expiresAt, new Date())
          )
        );
      await this.audit.logInTransaction(
        {
          actorId: user.id,
          actorRole: user.role,
          action: "ACCESS_GRANT_REVOKED",
          resourceType: "consent",
          resourceId: consent.id,
          outcome: "SUCCESS",
          ipHash,
        },
        transaction
      );
      const notificationDeliveries =
        await this.notifications.recordForPatientAndGuardians(
          consent.patientId,
          "ACCESS_REVOKED",
          consent.accessRequestId,
          transaction
        );
      return { notificationDeliveries };
    });
    await this.notifications.deliverDevelopmentEmails(notificationDeliveries);
    return { status: "revoked" };
  }
}
