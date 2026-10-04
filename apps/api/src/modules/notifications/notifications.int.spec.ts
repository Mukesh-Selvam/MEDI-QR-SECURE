import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../database/index.js";
import {
  guardianships,
  notifications,
  patients,
  users,
} from "../../database/schema.js";
import { NotificationsService } from "./notifications.service.js";

describe("Notifications (integration)", () => {
  const suffix = randomUUID();
  const requestId = randomUUID();
  const emailProvider = { send: vi.fn().mockResolvedValue(undefined) };
  const service = new NotificationsService(emailProvider);
  let patientUserId: string;
  let patientId: string;
  let guardianUserId: string;
  let guardianPatientId: string;
  let otherUserId: string;
  let otherPatientId: string;

  beforeAll(async () => {
    const migration = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'notifications'`
    );
    expect(migration.rows).toHaveLength(1);

    const [patientUser] = await db
      .insert(users)
      .values({
        email: `notification-patient-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    patientUserId = patientUser.id;

    const [patient] = await db
      .insert(patients)
      .values({
        userId: patientUser.id,
        healthId: `TEST-NOTIFY-${suffix}`,
        fullName: "Fake Notification Patient",
        phoneHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "test-only-ciphertext",
      })
      .returning({ id: patients.id });
    patientId = patient.id;

    const [guardianUser] = await db
      .insert(users)
      .values({
        email: `notification-guardian-${suffix}@mediqr.invalid`,
        role: "guardian",
        status: "active",
      })
      .returning({ id: users.id });
    guardianUserId = guardianUser.id;

    const [guardianPatient] = await db
      .insert(patients)
      .values({
        userId: guardianUser.id,
        healthId: `TEST-NOTIFY-GUARD-${suffix}`,
        fullName: "Fake Notification Guardian",
        phoneHash: suffix
          .replaceAll("-", "")
          .split("")
          .reverse()
          .join("")
          .padEnd(64, "0")
          .slice(0, 64),
        encryptedPhone: "test-only-ciphertext",
      })
      .returning({ id: patients.id });
    guardianPatientId = guardianPatient.id;

    const [otherUser] = await db
      .insert(users)
      .values({
        email: `notification-other-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    otherUserId = otherUser.id;

    const [otherPatient] = await db
      .insert(patients)
      .values({
        userId: otherUser.id,
        healthId: `TEST-NOTIFY-OTHER-${suffix}`,
        fullName: "Fake Other Notification Patient",
        phoneHash: suffix
          .replaceAll("-", "")
          .slice(0, 20)
          .padStart(64, "1"),
        encryptedPhone: "test-only-ciphertext",
      })
      .returning({ id: patients.id });
    otherPatientId = otherPatient.id;

    await db.insert(guardianships).values({
      guardianPatientId,
      wardPatientId: patientId,
      relationship: "legal_guardian",
      verificationStatus: "verified",
    });
  });

  afterAll(async () => {
    if (patientId) {
      await db.delete(notifications).where(eq(notifications.requestId, requestId));
      await db.delete(patients).where(eq(patients.id, patientId));
    }
    if (guardianPatientId) {
      await db.delete(patients).where(eq(patients.id, guardianPatientId));
    }
    if (otherPatientId) {
      await db.delete(patients).where(eq(patients.id, otherPatientId));
    }
    if (patientUserId) await db.delete(users).where(eq(users.id, patientUserId));
    if (guardianUserId) await db.delete(users).where(eq(users.id, guardianUserId));
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it("stores every access event for the patient and active guardian", async () => {
    const eventTypes = [
      "ACCESS_REQUESTED",
      "ACCESS_APPROVED",
      "ACCESS_DENIED",
      "DOCUMENT_READ",
      "ACCESS_REVOKED",
    ] as const;

    for (const eventType of eventTypes) {
      const deliveries = await service.recordForPatientAndGuardians(
        patientId,
        eventType,
        requestId
      );
      expect(deliveries.map(({ recipientUserId }) => recipientUserId).sort()).toEqual(
        [patientUserId, guardianUserId].sort()
      );
      await service.deliverDevelopmentEmails(deliveries);
    }

    const patientNotifications = await service.listForUser(patientUserId);
    const guardianNotifications = await service.listForUser(guardianUserId);
    expect(patientNotifications.map(({ eventType }) => eventType)).toEqual(
      eventTypes
    );
    expect(guardianNotifications.map(({ eventType }) => eventType)).toEqual(
      eventTypes
    );
    expect(emailProvider.send).toHaveBeenCalledTimes(eventTypes.length * 2);
    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ACCESS_REQUESTED",
        requestId,
      })
    );
  });

  it("isolates list and read state to the authenticated recipient", async () => {
    const otherRequestId = randomUUID();
    await service.recordForPatientAndGuardians(
      otherPatientId,
      "ACCESS_REQUESTED",
      otherRequestId
    );
    const patientNotifications = await service.listForUser(patientUserId);
    const otherNotifications = await service.listForUser(otherUserId);
    expect(patientNotifications.every(({ requestId: id }) => id === requestId)).toBe(
      true
    );
    expect(otherNotifications.map(({ requestId: id }) => id)).toEqual([
      otherRequestId,
    ]);

    const patientNotification = patientNotifications[0];
    await expect(
      service.markRead(otherUserId, patientNotification.id)
    ).rejects.toThrow("Notification not found");
    await service.markRead(patientUserId, patientNotification.id);
    const [markedRead] = await service.listForUser(patientUserId);
    expect(markedRead.readAt).toBeInstanceOf(Date);
  });
});
