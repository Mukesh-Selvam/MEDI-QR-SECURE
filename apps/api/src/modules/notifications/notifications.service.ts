import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../database/index.js";
import {
  guardianships,
  notificationEventTypeEnum,
  notifications,
  patients,
  users,
} from "../../database/schema.js";
import {
  NOTIFICATION_EMAIL_PROVIDER,
  NotificationEmailDeliveryError,
  type NotificationEmailProvider,
} from "./notification-email.provider.js";

const guardianPatients = alias(patients, "notification_guardian_patient");
const wardPatients = alias(patients, "notification_ward_patient");

type NotificationExecutor = Pick<typeof db, "select" | "insert" | "update">;
export type NotificationEventType =
  (typeof notificationEventTypeEnum.enumValues)[number];

export interface NotificationDelivery {
  id: string;
  recipientUserId: string;
  recipientEmail: string | null;
  eventType: NotificationEventType;
  requestId: string;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_EMAIL_PROVIDER)
    private readonly emailProvider: NotificationEmailProvider
  ) {}

  async recordForPatientAndGuardians(
    patientId: string,
    eventType: NotificationEventType,
    requestId: string,
    executor?: NotificationExecutor
  ): Promise<NotificationDelivery[]> {
    const record = async (
      transaction: NotificationExecutor
    ): Promise<NotificationDelivery[]> => {
      const [patientRecipient] = await transaction
        .select({ userId: users.id, email: users.email })
        .from(patients)
        .innerJoin(users, eq(patients.userId, users.id))
        .where(
          and(
            eq(patients.id, patientId),
            eq(users.status, "active")
          )
        )
        .limit(1);

      const guardianRecipients = await transaction
        .select({ userId: users.id, email: users.email })
        .from(guardianships)
        .innerJoin(
          guardianPatients,
          eq(guardianships.guardianPatientId, guardianPatients.id)
        )
        .innerJoin(users, eq(guardianPatients.userId, users.id))
        .innerJoin(
          wardPatients,
          eq(guardianships.wardPatientId, wardPatients.id)
        )
        .where(
          and(
            eq(wardPatients.id, patientId),
            eq(guardianships.verificationStatus, "verified"),
            eq(users.status, "active"),
            or(
              isNull(guardianships.validUntil),
              gt(guardianships.validUntil, new Date())
            )
          )
        );

      const recipientMap = new Map(
        [patientRecipient, ...guardianRecipients]
          .filter(
            (recipient): recipient is NonNullable<typeof recipient> =>
              recipient !== undefined
          )
          .map((recipient) => [recipient.userId, recipient.email])
      );

      const deliveryRecords: NotificationDelivery[] = [];
      for (const [recipientUserId, recipientEmail] of recipientMap) {
        const [created] = await transaction
          .insert(notifications)
          .values({ recipientUserId, eventType, requestId })
          .returning({
            id: notifications.id,
            eventType: notifications.eventType,
            requestId: notifications.requestId,
            createdAt: notifications.createdAt,
          });
        if (!created) {
          throw new Error("Notification insert did not return a row.");
        }
        deliveryRecords.push({
          ...created,
          recipientUserId,
          recipientEmail,
        });
      }
      return deliveryRecords;
    };

    return executor ? record(executor) : db.transaction(record);
  }

  async deliverDevelopmentEmails(
    deliveries: readonly NotificationDelivery[]
  ): Promise<void> {
    for (const delivery of deliveries) {
      if (!delivery.recipientEmail) continue;
      try {
        await this.emailProvider.send({
          recipient: delivery.recipientEmail,
          eventType: delivery.eventType,
          requestId: delivery.requestId,
          createdAt: delivery.createdAt,
        });
      } catch (error) {
        if (!(error instanceof NotificationEmailDeliveryError)) throw error;
        this.logger.error("Development notification email delivery failed.");
      }
    }
  }

  async listForUser(userId: string) {
    return db
      .select({
        id: notifications.id,
        eventType: notifications.eventType,
        requestId: notifications.requestId,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId))
      .orderBy(notifications.createdAt);
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, userId),
          isNull(notifications.readAt)
        )
      )
      .returning({ id: notifications.id });
    if (!updated) throw new NotFoundException("Notification not found");
  }
}
