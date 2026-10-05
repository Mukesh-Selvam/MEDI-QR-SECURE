import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gte, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { env } from "../../config/env.js";
import { db } from "../../database/index.js";
import {
  guardianships,
  notificationEmailOutbox,
  notificationEventTypeEnum,
  notifications,
  patients,
  users,
} from "../../database/schema.js";
import {
  NOTIFICATION_EMAIL_PROVIDER,
  NotificationEmailDeliveryError,
  type NotificationEmail,
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

const OUTBOX_POLL_INTERVAL_MS = 5_000;
const OUTBOX_LEASE_MS = 2 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000] as const;

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private outboxTimer: NodeJS.Timeout | undefined;
  private outboxProcessing = false;

  constructor(
    @Inject(NOTIFICATION_EMAIL_PROVIDER)
    private readonly emailProvider: NotificationEmailProvider,
  ) {}

  onModuleInit(): void {
    if (!this.emailProvider.enabled || env.NODE_ENV === "test") return;
    this.outboxTimer = setInterval(() => {
      void this.processPendingEmergencyEmails().catch(() => {
        this.logger.error("Emergency notification outbox processing failed.");
      });
    }, OUTBOX_POLL_INTERVAL_MS);
    this.outboxTimer.unref();
    void this.processPendingEmergencyEmails().catch(() => {
      this.logger.error("Emergency notification outbox processing failed.");
    });
  }

  onModuleDestroy(): void {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
  }

  async recordForPatientAndGuardians(
    patientId: string,
    eventType: NotificationEventType,
    requestId: string,
    executor?: NotificationExecutor,
  ): Promise<NotificationDelivery[]> {
    const record = async (
      transaction: NotificationExecutor,
    ): Promise<NotificationDelivery[]> => {
      const [patientRecipient] = await transaction
        .select({ userId: users.id, email: users.email })
        .from(patients)
        .innerJoin(users, eq(patients.userId, users.id))
        .where(and(eq(patients.id, patientId), eq(users.status, "active")))
        .limit(1);

      const guardianRecipients = await transaction
        .select({ userId: users.id, email: users.email })
        .from(guardianships)
        .innerJoin(
          guardianPatients,
          eq(guardianships.guardianPatientId, guardianPatients.id),
        )
        .innerJoin(users, eq(guardianPatients.userId, users.id))
        .innerJoin(
          wardPatients,
          eq(guardianships.wardPatientId, wardPatients.id),
        )
        .where(
          and(
            eq(wardPatients.id, patientId),
            eq(guardianships.verificationStatus, "verified"),
            eq(users.status, "active"),
            or(
              isNull(guardianships.validUntil),
              gt(guardianships.validUntil, new Date()),
            ),
          ),
        );

      const recipientMap = new Map(
        [patientRecipient, ...guardianRecipients]
          .filter(
            (recipient): recipient is NonNullable<typeof recipient> =>
              recipient !== undefined,
          )
          .map((recipient) => [recipient.userId, recipient.email]),
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

  async queueEmergencyEmailOutbox(
    deliveries: readonly NotificationDelivery[],
    executor: NotificationExecutor,
  ): Promise<string[]> {
    if (!this.emailProvider.enabled) return [];

    const queuedRecipients: string[] = [];
    for (const delivery of deliveries) {
      if (delivery.eventType !== "EMERGENCY_ACCESS_GRANTED") {
        throw new Error("Only emergency notifications may use this outbox.");
      }
      if (!delivery.recipientEmail) continue;
      const [queued] = await executor
        .insert(notificationEmailOutbox)
        .values({ notificationId: delivery.id })
        .onConflictDoNothing({
          target: notificationEmailOutbox.notificationId,
        })
        .returning({ id: notificationEmailOutbox.id });
      if (queued) queuedRecipients.push(delivery.recipientUserId);
    }
    return queuedRecipients;
  }

  async processPendingEmergencyEmails(): Promise<void> {
    if (!this.emailProvider.enabled || this.outboxProcessing) return;
    this.outboxProcessing = true;
    try {
      const { messages, recoveredExhaustedCount } = await db.transaction(
        async (transaction) => {
          const now = new Date();
          const recoveredExhaustedItems = await transaction
            .update(notificationEmailOutbox)
            .set({ failedAt: now, lockedUntil: null })
            .where(
              and(
                gte(notificationEmailOutbox.attempts, OUTBOX_MAX_ATTEMPTS),
                isNotNull(notificationEmailOutbox.lockedUntil),
                lt(notificationEmailOutbox.lockedUntil, now),
                isNull(notificationEmailOutbox.sentAt),
                isNull(notificationEmailOutbox.failedAt),
              ),
            )
            .returning({ id: notificationEmailOutbox.id });
          const candidates = await transaction
            .select({
              id: notificationEmailOutbox.id,
              attempts: notificationEmailOutbox.attempts,
              recipient: users.email,
              eventType: notifications.eventType,
              requestId: notifications.requestId,
              createdAt: notifications.createdAt,
            })
            .from(notificationEmailOutbox)
            .innerJoin(
              notifications,
              eq(notificationEmailOutbox.notificationId, notifications.id),
            )
            .innerJoin(users, eq(notifications.recipientUserId, users.id))
            .where(
              and(
                lte(notificationEmailOutbox.nextAttemptAt, now),
                lt(notificationEmailOutbox.attempts, OUTBOX_MAX_ATTEMPTS),
                isNull(notificationEmailOutbox.sentAt),
                isNull(notificationEmailOutbox.failedAt),
                or(
                  isNull(notificationEmailOutbox.lockedUntil),
                  lt(notificationEmailOutbox.lockedUntil, now),
                ),
              ),
            )
            .for("update", { skipLocked: true })
            .limit(OUTBOX_BATCH_SIZE);

          for (const candidate of candidates) {
            await transaction
              .update(notificationEmailOutbox)
              .set({
                attempts: candidate.attempts + 1,
                lockedUntil: new Date(now.getTime() + OUTBOX_LEASE_MS),
              })
              .where(eq(notificationEmailOutbox.id, candidate.id));
          }
          return {
            messages: candidates.map((candidate) => ({
              ...candidate,
              attempts: candidate.attempts + 1,
            })),
            recoveredExhaustedCount: recoveredExhaustedItems.length,
          };
        },
      );

      if (recoveredExhaustedCount > 0) {
        this.logger.error(
          `Emergency notification retries exhausted for ${recoveredExhaustedCount} outbox item(s).`,
        );
      }
      for (const message of messages) {
        if (!message.recipient) {
          await this.finishEmergencyEmail(message.id, false, message.attempts);
          continue;
        }
        const email: NotificationEmail = {
          recipient: message.recipient,
          eventType: message.eventType,
          requestId: message.requestId,
          createdAt: message.createdAt,
        };
        try {
          await this.emailProvider.send(email);
          await this.finishEmergencyEmail(message.id, true, message.attempts);
        } catch (error) {
          if (error instanceof NotificationEmailDeliveryError) {
            this.logger.warn(
              "Emergency notification email delivery failed; retry scheduled.",
            );
          } else {
            this.logger.error(
              "Unexpected emergency notification delivery error; retry scheduled.",
            );
          }
          await this.finishEmergencyEmail(message.id, false, message.attempts);
        }
      }
    } finally {
      this.outboxProcessing = false;
    }
  }

  private async finishEmergencyEmail(
    id: string,
    sent: boolean,
    attempts: number,
  ): Promise<void> {
    const now = new Date();
    const exhausted = !sent && attempts >= OUTBOX_MAX_ATTEMPTS;
    const nextAttemptAt =
      !sent && !exhausted
        ? new Date(now.getTime() + OUTBOX_RETRY_DELAYS_MS[attempts - 1]!)
        : now;
    const [updated] = await db
      .update(notificationEmailOutbox)
      .set({
        sentAt: sent ? now : null,
        failedAt: exhausted ? now : null,
        nextAttemptAt,
        lockedUntil: null,
      })
      .where(eq(notificationEmailOutbox.id, id))
      .returning({ id: notificationEmailOutbox.id });
    if (!updated) {
      throw new Error("Emergency notification outbox update returned no row.");
    }
    if (exhausted) {
      this.logger.error("Emergency notification email retries exhausted.");
    }
  }

  async deliverDevelopmentEmails(
    deliveries: readonly NotificationDelivery[],
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
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (!updated) throw new NotFoundException("Notification not found");
  }
}
