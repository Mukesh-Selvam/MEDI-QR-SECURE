import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRedisClient } from "../../config/redis.config.js";
import { db } from "../../database/index.js";
import {
  auditEvents,
  documents,
  emergencyAccessRequests,
  emergencyAccessReviews,
  emergencyProfiles,
  facilities,
  facilityStaffAffiliations,
  guardianships,
  notificationEmailOutbox,
  notifications,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { AuditService } from "../audit/audit.service.js";
import {
  NotificationEmailDeliveryError,
  type NotificationEmailProvider,
} from "../notifications/notification-email.provider.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { QrCredentialsService } from "../qr/qr-credentials.service.js";
import { QrResolutionService } from "../qr/qr-resolution.service.js";
import { LocalKmsAdapter } from "../vault/kms/local-kms.adapter.js";
import { VaultCryptoService } from "../vault/crypto/vault-crypto.service.js";
import { EmergencyAccessService } from "./emergency-access.service.js";
import { EmergencyProfileService } from "./emergency-profile.service.js";

describe("Emergency access grants and summaries (integration)", () => {
  const suffix = randomUUID();
  const audit = new AuditService();
  const kms = new LocalKmsAdapter();
  const emailProvider: NotificationEmailProvider = {
    enabled: true,
    send: vi
      .fn()
      .mockRejectedValueOnce(new NotificationEmailDeliveryError())
      .mockResolvedValue(undefined),
  };
  let crypto: VaultCryptoService;
  let notificationsService: NotificationsService;
  let resolution: QrResolutionService;
  let credentials: QrCredentialsService;
  let service: EmergencyAccessService;
  let profileService: EmergencyProfileService;
  let patientUserId: string;
  let guardianUserId: string;
  let edStaffUserId: string;
  let pharmacyStaffUserId: string;
  let patientId: string;
  let guardianPatientId: string;
  let edFacilityId: string;
  let pharmacyFacilityId: string;
  let prescriptionDocumentIds: string[] = [];
  const requestIds: string[] = [];
  const documentPatientIds: string[] = [];
  const additionalPatientIds: string[] = [];
  const additionalUserIds: string[] = [];

  const makeActor = (
    id: string,
    role:
      "emergency-department-staff" | "pharmacy-staff" | "patient" | "guardian",
  ): AuthenticatedUser => ({ id, sub: id, role });

  async function createResolution(
    patientUserIdToResolve: string,
  ): Promise<string> {
    const credential = await credentials.issueOrRotate(
      patientUserIdToResolve,
      "patient",
      audit.hashIp("127.0.0.1"),
    );
    const resolutionId = randomUUID();
    await resolution.resolve(
      credential.credentialToken,
      resolutionId,
      "127.0.0.1",
    );
    return resolutionId;
  }

  beforeAll(async () => {
    kms.onModuleInit();
    crypto = new VaultCryptoService(kms);
    notificationsService = new NotificationsService(emailProvider);
    resolution = new QrResolutionService(createRedisClient(), audit);
    credentials = new QrCredentialsService(audit);
    service = new EmergencyAccessService(
      audit,
      resolution,
      notificationsService,
      crypto,
    );
    profileService = new EmergencyProfileService(crypto, audit);

    const fakeUsers = await db
      .insert(users)
      .values([
        {
          email: `fake-emergency-patient-${suffix}@mediqr.invalid`,
          role: "patient",
          status: "active",
        },
        {
          email: `fake-emergency-guardian-${suffix}@mediqr.invalid`,
          role: "guardian",
          status: "active",
        },
        { role: "emergency-department-staff", status: "active" },
        { role: "pharmacy-staff", status: "active" },
      ])
      .returning({ id: users.id, role: users.role });
    const byRole = new Map(fakeUsers.map((user) => [user.role, user.id]));
    patientUserId = byRole.get("patient")!;
    guardianUserId = byRole.get("guardian")!;
    edStaffUserId = byRole.get("emergency-department-staff")!;
    pharmacyStaffUserId = byRole.get("pharmacy-staff")!;

    const [patient] = await db
      .insert(patients)
      .values({
        userId: patientUserId,
        healthId: `FAKE-EMERGENCY-${suffix}`,
        fullName: "Fake Emergency Patient",
        phoneHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "fake-test-ciphertext",
      })
      .returning({ id: patients.id });
    patientId = patient.id;
    const [guardianPatient] = await db
      .insert(patients)
      .values({
        userId: guardianUserId,
        healthId: `FAKE-GUARDIAN-${suffix}`,
        fullName: "Fake Emergency Guardian",
        phoneHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        encryptedPhone: "fake-test-ciphertext",
      })
      .returning({ id: patients.id });
    guardianPatientId = guardianPatient.id;
    await db.insert(guardianships).values({
      guardianPatientId,
      wardPatientId: patientId,
      relationship: "mother",
      verificationStatus: "verified",
    });

    const createdFacilities = await db
      .insert(facilities)
      .values([
        {
          facilityType: "hospital-emergency-department",
          displayName: `FAKE Emergency Department ${suffix}`,
          registrationNumber: `FAKE-ED-${suffix}`,
          registrationJurisdiction: "FAKE-TEST",
          verificationStatus: "verified",
        },
        {
          facilityType: "pharmacy",
          displayName: `FAKE Pharmacy ${suffix}`,
          registrationNumber: `FAKE-PHARM-${suffix}`,
          registrationJurisdiction: "FAKE-TEST",
          verificationStatus: "verified",
        },
      ])
      .returning({ id: facilities.id, facilityType: facilities.facilityType });
    edFacilityId = createdFacilities.find(
      ({ facilityType }) => facilityType === "hospital-emergency-department",
    )!.id;
    pharmacyFacilityId = createdFacilities.find(
      ({ facilityType }) => facilityType === "pharmacy",
    )!.id;
    await db.insert(facilityStaffAffiliations).values([
      {
        facilityId: edFacilityId,
        userId: edStaffUserId,
        role: "emergency-department-staff",
        status: "active",
      },
      {
        facilityId: pharmacyFacilityId,
        userId: pharmacyStaffUserId,
        role: "pharmacy-staff",
        status: "active",
      },
    ]);

    const profilePayload = Buffer.from(
      JSON.stringify({
        bloodGroup: "B+",
        allergies: ["FAKE patient-declared allergy"],
        emergencyContacts: [
          { name: "FAKE Contact", relationship: "relative", phone: "00000" },
        ],
      }),
      "utf8",
    );
    const encrypted = await crypto.encrypt(profilePayload);
    profilePayload.fill(0);
    await db.insert(emergencyProfiles).values({
      patientId,
      encryptedPayload: encrypted.ciphertext.toString("base64"),
      wrappedDek: encrypted.wrappedDek,
      kmsKeyId: encrypted.kmsKeyId,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      sha256Plaintext: encrypted.sha256Plaintext,
      enabled: true,
      updatedByUserId: patientUserId,
    });

    const documentRecords = await db
      .insert(documents)
      .values([
        ...Array.from({ length: 6 }, (_, index) => ({
          patientId,
          uploaderId: patientUserId,
          uploadSource: "patient-uploaded" as const,
          documentType: "prescription" as const,
          storageKey: `fake-emergency-doc-${randomUUID()}`,
          storageBucket: "fake-bucket",
          mimeType: "application/pdf",
          fileSizeBytes: 12,
          status: "ready" as const,
          scanStatus: "clean" as const,
          documentDate: new Date(Date.UTC(2025, index, 10)),
        })),
        {
          patientId,
          uploaderId: patientUserId,
          uploadSource: "patient-uploaded",
          documentType: "prescription",
          storageKey: `fake-emergency-doc-${randomUUID()}`,
          storageBucket: "fake-bucket",
          mimeType: "application/pdf",
          fileSizeBytes: 12,
          status: "ready",
          scanStatus: "clean",
          documentDate: new Date("2025-07-10T00:00:00.000Z"),
        },
        {
          patientId,
          uploaderId: patientUserId,
          uploadSource: "patient-uploaded",
          documentType: "prescription",
          storageKey: `fake-emergency-doc-${randomUUID()}`,
          storageBucket: "fake-bucket",
          mimeType: "application/pdf",
          fileSizeBytes: 12,
          status: "quarantined",
          scanStatus: "pending",
          documentDate: new Date("2025-08-10T00:00:00.000Z"),
          emergencyVisible: true,
        },
        {
          patientId,
          uploaderId: patientUserId,
          uploadSource: "patient-uploaded",
          documentType: "lab",
          storageKey: `fake-emergency-doc-${randomUUID()}`,
          storageBucket: "fake-bucket",
          mimeType: "application/pdf",
          fileSizeBytes: 12,
          status: "ready",
          scanStatus: "clean",
          documentDate: new Date("2025-09-10T00:00:00.000Z"),
          emergencyVisible: true,
        },
      ])
      .returning({ id: documents.id, documentType: documents.documentType });
    prescriptionDocumentIds = documentRecords
      .filter(({ documentType }) => documentType === "prescription")
      .map(({ id }) => id);
    documentPatientIds.push(patientId);
  });

  afterAll(async () => {
    if (documentPatientIds.length > 0) {
      await db
        .delete(documents)
        .where(inArray(documents.patientId, documentPatientIds));
    }
    const patientIds = [
      patientId,
      guardianPatientId,
      ...additionalPatientIds,
    ].filter(Boolean);
    if (patientIds.length > 0) {
      const requests = await db
        .select({ id: emergencyAccessRequests.id })
        .from(emergencyAccessRequests)
        .where(inArray(emergencyAccessRequests.patientId, patientIds));
      const ids = requests.map(({ id }) => id);
      if (ids.length > 0) {
        await db
          .delete(notifications)
          .where(inArray(notifications.requestId, ids));
        await db
          .delete(emergencyAccessRequests)
          .where(inArray(emergencyAccessRequests.id, ids));
      }
      await db
        .delete(qrCredentials)
        .where(inArray(qrCredentials.patientId, patientIds));
      await db
        .delete(guardianships)
        .where(eq(guardianships.wardPatientId, patientId));
      await db.delete(patients).where(inArray(patients.id, patientIds));
    }
    if (edFacilityId && pharmacyFacilityId) {
      await db
        .delete(facilityStaffAffiliations)
        .where(
          inArray(facilityStaffAffiliations.facilityId, [
            edFacilityId,
            pharmacyFacilityId,
          ]),
        );
      await db
        .delete(facilities)
        .where(inArray(facilities.id, [edFacilityId, pharmacyFacilityId]));
    }
    const userIds = [
      patientUserId,
      guardianUserId,
      edStaffUserId,
      pharmacyStaffUserId,
      ...additionalUserIds,
    ].filter(Boolean);
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    if (resolution) await resolution.onModuleDestroy();
  });

  it("creates an audited fixed grant, notifies patient and guardian, and returns only eligible hospital metadata", async () => {
    const defaultOffDocuments = await db
      .select({
        emergencyVisible: documents.emergencyVisible,
      })
      .from(documents)
      .where(inArray(documents.id, prescriptionDocumentIds.slice(0, 6)));
    expect(defaultOffDocuments).toHaveLength(6);
    expect(
      defaultOffDocuments.every(({ emergencyVisible }) => !emergencyVisible),
    ).toBe(true);

    for (const [index, documentId] of prescriptionDocumentIds
      .slice(0, 6)
      .entries()) {
      await service.updatePrescriptionVisibility(
        documentId,
        { emergencyVisible: true },
        index === 5
          ? makeActor(guardianUserId, "guardian")
          : makeActor(patientUserId, "patient"),
        "127.0.0.1",
      );
    }
    await service.updatePrescriptionVisibility(
      prescriptionDocumentIds[0]!,
      { emergencyVisible: false },
      makeActor(patientUserId, "patient"),
      "127.0.0.1",
    );
    await service.updatePrescriptionVisibility(
      prescriptionDocumentIds[0]!,
      { emergencyVisible: true },
      makeActor(patientUserId, "patient"),
      "127.0.0.1",
    );

    const visibilityEvents = await db
      .select({
        action: auditEvents.action,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.resourceId, prescriptionDocumentIds.slice(0, 6)),
          eq(auditEvents.action, "EMERGENCY_DOCUMENT_VISIBLE_FALSE_TO_TRUE"),
        ),
      );
    expect(visibilityEvents).toHaveLength(7);
    const disabledEvent = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, prescriptionDocumentIds[0]!),
          eq(auditEvents.action, "EMERGENCY_DOCUMENT_VISIBLE_TRUE_TO_FALSE"),
        ),
      );
    expect(disabledEvent).toHaveLength(1);

    const resolutionId = await createResolution(patientUserId);
    const result = await service.createRequest(
      edFacilityId,
      {
        resolutionId,
        reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
      },
      makeActor(edStaffUserId, "emergency-department-staff"),
      "127.0.0.1",
      "integration-test",
    );
    requestIds.push(result.requestId);
    expect(result.status).toBe("granted");

    const [grant] = await db
      .select()
      .from(emergencyAccessRequests)
      .where(eq(emergencyAccessRequests.id, result.requestId));
    expect(grant.expiresAt!.getTime() - grant.grantedAt!.getTime()).toBe(
      30 * 60 * 1000,
    );
    expect(grant.notificationChannelMissing).toBe(false);
    expect(grant.priorityReview).toBe(false);
    expect(grant.reasonCode).toBe("TIME_CRITICAL_EMERGENCY_CARE");
    const [review] = await db
      .select({ reviewDueAt: emergencyAccessReviews.reviewDueAt })
      .from(emergencyAccessReviews)
      .where(eq(emergencyAccessReviews.requestId, result.requestId));
    expect(review.reviewDueAt.getTime() - grant.grantedAt!.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );

    const recipients = await db
      .select({
        recipientUserId: notifications.recipientUserId,
        eventType: notifications.eventType,
        requestId: notifications.requestId,
      })
      .from(notifications)
      .where(eq(notifications.requestId, result.requestId));
    expect(recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientUserId: patientUserId,
          eventType: "EMERGENCY_ACCESS_GRANTED",
          requestId: result.requestId,
        }),
        expect.objectContaining({
          recipientUserId: guardianUserId,
          eventType: "EMERGENCY_ACCESS_GRANTED",
          requestId: result.requestId,
        }),
      ]),
    );
    const queuedEmails = await db
      .select({
        id: notificationEmailOutbox.id,
        notificationId: notificationEmailOutbox.notificationId,
        attempts: notificationEmailOutbox.attempts,
        sentAt: notificationEmailOutbox.sentAt,
        failedAt: notificationEmailOutbox.failedAt,
      })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.requestId, result.requestId));
    expect(queuedEmails).toHaveLength(2);
    expect(queuedEmails.every(({ attempts }) => attempts === 0)).toBe(true);

    await notificationsService.processPendingEmergencyEmails();
    const firstDeliveryAttempt = await db
      .select({
        id: notificationEmailOutbox.id,
        attempts: notificationEmailOutbox.attempts,
        nextAttemptAt: notificationEmailOutbox.nextAttemptAt,
        sentAt: notificationEmailOutbox.sentAt,
      })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.requestId, result.requestId));
    expect(
      firstDeliveryAttempt.filter(({ attempts }) => attempts === 1),
    ).toHaveLength(2);
    expect(
      firstDeliveryAttempt.filter(({ sentAt }) => sentAt !== null),
    ).toHaveLength(1);

    const pendingEmailIds = firstDeliveryAttempt
      .filter(({ sentAt }) => sentAt === null)
      .map(({ id }) => id);
    await db
      .update(notificationEmailOutbox)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(inArray(notificationEmailOutbox.id, pendingEmailIds));
    await notificationsService.processPendingEmergencyEmails();
    const retriedEmails = await db
      .select({
        id: notificationEmailOutbox.id,
        attempts: notificationEmailOutbox.attempts,
        sentAt: notificationEmailOutbox.sentAt,
      })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.requestId, result.requestId));
    expect(retriedEmails.every(({ sentAt }) => sentAt !== null)).toBe(true);
    expect(retriedEmails.some(({ attempts }) => attempts === 2)).toBe(true);

    const expiredFinalAttemptId = retriedEmails[0]!.id;
    await db
      .update(notificationEmailOutbox)
      .set({
        attempts: 5,
        failedAt: null,
        lockedUntil: new Date(Date.now() - 1_000),
        nextAttemptAt: new Date(Date.now() - 1_000),
        sentAt: null,
      })
      .where(eq(notificationEmailOutbox.id, expiredFinalAttemptId));
    const operatorAlert = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await notificationsService.processPendingEmergencyEmails();
    expect(operatorAlert).toHaveBeenCalledWith(
      expect.stringContaining("retries exhausted"),
    );
    operatorAlert.mockRestore();
    const [exhaustedEmail] = await db
      .select({ failedAt: notificationEmailOutbox.failedAt })
      .from(notificationEmailOutbox)
      .where(eq(notificationEmailOutbox.id, expiredFinalAttemptId));
    expect(exhaustedEmail.failedAt).toBeInstanceOf(Date);
    await notificationsService.processPendingEmergencyEmails();
    expect(emailProvider.send).toHaveBeenCalledTimes(3);

    const failingSummaryAudit = {
      hashIp: vi.fn(() => "f".repeat(64)),
      logInTransaction: vi
        .fn()
        .mockRejectedValue(new Error("summary audit unavailable")),
    };
    const serviceWithFailingSummaryAudit = new EmergencyAccessService(
      failingSummaryAudit,
      resolution,
      notificationsService,
      crypto,
    );
    await expect(
      serviceWithFailingSummaryAudit.readSummary(
        result.requestId,
        makeActor(edStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("summary audit unavailable");
    const failedSummaryAuditRows = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, result.requestId),
          eq(auditEvents.action, "EMERGENCY_SUMMARY_READ"),
        ),
      );
    expect(failedSummaryAuditRows).toHaveLength(0);

    const summary = await service.readSummary(
      result.requestId,
      makeActor(edStaffUserId, "emergency-department-staff"),
      "127.0.0.1",
      "integration-test",
    );
    expect(summary).toMatchObject({
      requestId: result.requestId,
      bloodGroup: "B+",
      allergies: ["FAKE patient-declared allergy"],
      emergencyContacts: [
        { name: "FAKE Contact", relationship: "relative", phone: "00000" },
      ],
    });
    expect(summary.expiresAt).toBe(result.expiresAt);
    expect("prescriptions" in summary ? summary.prescriptions : []).toEqual([
      { type: "prescription", date: "2025-06-10" },
      { type: "prescription", date: "2025-05-10" },
      { type: "prescription", date: "2025-04-10" },
      { type: "prescription", date: "2025-03-10" },
      { type: "prescription", date: "2025-02-10" },
    ]);
    if ("prescriptions" in summary) {
      expect(summary.prescriptions).toHaveLength(5);
      expect(
        summary.prescriptions.every(
          (prescription) =>
            Object.keys(prescription).sort().join(",") === "date,type",
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(summary)).not.toContain("storageKey");
    expect(JSON.stringify(summary)).not.toContain("fake-emergency-doc");

    const eventRows = await db
      .select({
        action: auditEvents.action,
        actorId: auditEvents.actorId,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.resourceId, [result.requestId]),
          inArray(auditEvents.action, [
            "EMERGENCY_ACCESS_REQUEST_GRANTED",
            "EMERGENCY_SUMMARY_READ",
          ]),
        ),
      );
    expect(eventRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "EMERGENCY_ACCESS_REQUEST_GRANTED",
          actorId: edStaffUserId,
          resourceId: result.requestId,
        }),
        expect.objectContaining({
          action: "EMERGENCY_SUMMARY_READ",
          actorId: edStaffUserId,
          resourceId: result.requestId,
        }),
      ]),
    );
    expect(
      eventRows.every(({ resourceId }) => /^[0-9a-f-]{36}$/i.test(resourceId)),
    ).toBe(true);
  });

  it("rejects emergency visibility changes for non-prescriptions, unready records, and unrelated accounts", async () => {
    const readyPrescriptionId = prescriptionDocumentIds[0]!;
    const unreadyPrescriptionId = prescriptionDocumentIds[7]!;
    await expect(
      service.updatePrescriptionVisibility(
        readyPrescriptionId,
        { emergencyVisible: true },
        makeActor(guardianUserId, "patient"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency document visibility unavailable.");
    await expect(
      service.updatePrescriptionVisibility(
        unreadyPrescriptionId,
        { emergencyVisible: true },
        makeActor(patientUserId, "patient"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency document visibility unavailable.");
    await expect(
      service.updatePrescriptionVisibility(
        readyPrescriptionId,
        { emergencyVisible: true },
        makeActor(edStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency document visibility unavailable.");
  });

  it("rechecks provider authorization before writing audit/outbox and returns only after commit", async () => {
    const sequence: string[] = [];
    const writeAudit = audit.logInTransaction.bind(audit);
    const recordNotifications =
      notificationsService.recordForPatientAndGuardians.bind(
        notificationsService,
      );
    const queueEmails =
      notificationsService.queueEmergencyEmailOutbox.bind(notificationsService);
    const auditSpy = vi
      .spyOn(audit, "logInTransaction")
      .mockImplementation(async (...args) => {
        sequence.push("audit");
        return writeAudit(...args);
      });
    const notificationSpy = vi
      .spyOn(notificationsService, "recordForPatientAndGuardians")
      .mockImplementation(async (...args) => {
        const deliveries = await recordNotifications(...args);
        sequence.push("notification");
        return deliveries;
      });
    const outboxSpy = vi
      .spyOn(notificationsService, "queueEmergencyEmailOutbox")
      .mockImplementation(async (...args) => {
        const recipients = await queueEmails(...args);
        sequence.push("outbox");
        return recipients;
      });
    const orderedService = new EmergencyAccessService(
      audit,
      resolution,
      notificationsService,
      crypto,
    );

    const unauthorizedResolution = await createResolution(patientUserId);
    sequence.length = 0;
    auditSpy.mockClear();
    notificationSpy.mockClear();
    outboxSpy.mockClear();
    await expect(
      orderedService.createRequest(
        edFacilityId,
        {
          resolutionId: unauthorizedResolution,
          reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
        },
        makeActor(pharmacyStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency access unavailable.");
    expect(sequence).toEqual([]);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(notificationSpy).not.toHaveBeenCalled();
    expect(outboxSpy).not.toHaveBeenCalled();

    const authorizedResolution = await createResolution(patientUserId);
    sequence.length = 0;
    auditSpy.mockClear();
    notificationSpy.mockClear();
    outboxSpy.mockClear();
    const result = await orderedService.createRequest(
      edFacilityId,
      {
        resolutionId: authorizedResolution,
        reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
      },
      makeActor(edStaffUserId, "emergency-department-staff"),
      "127.0.0.1",
    );
    requestIds.push(result.requestId);
    sequence.push("response");
    expect(sequence).toEqual(["audit", "notification", "outbox", "response"]);
    const persistedOutbox = await db
      .select({ id: notificationEmailOutbox.id })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.requestId, result.requestId));
    expect(persistedOutbox.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ status: "granted" });
    auditSpy.mockRestore();
    notificationSpy.mockRestore();
    outboxSpy.mockRestore();
  });

  it("limits pharmacy summary to allergies and revokes active grants when the profile is disabled", async () => {
    const resolutionId = await createResolution(patientUserId);
    const result = await service.createRequest(
      pharmacyFacilityId,
      {
        resolutionId,
        reasonCode: "GUARDIAN_UNAVAILABLE",
      },
      makeActor(pharmacyStaffUserId, "pharmacy-staff"),
      "127.0.0.1",
    );
    requestIds.push(result.requestId);

    const summary = await service.readSummary(
      result.requestId,
      makeActor(pharmacyStaffUserId, "pharmacy-staff"),
      "127.0.0.1",
    );
    expect(summary).toStrictEqual({
      requestId: result.requestId,
      expiresAt: result.expiresAt,
      allergies: ["FAKE patient-declared allergy"],
    });

    await profileService.update(
      patientId,
      makeActor(patientUserId, "patient"),
      {
        bloodGroup: "B+",
        allergies: ["FAKE patient-declared allergy"],
        emergencyContacts: [
          { name: "FAKE Contact", relationship: "relative", phone: "00000" },
        ],
        enabled: false,
      },
      "127.0.0.1",
    );
    const grants = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
      })
      .from(emergencyAccessRequests)
      .where(inArray(emergencyAccessRequests.id, requestIds));
    expect(grants.every(({ status }) => status === "revoked")).toBe(true);
    await expect(
      service.readSummary(
        result.requestId,
        makeActor(pharmacyStaffUserId, "pharmacy-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency access unavailable.");

    const revocationEvents = await db
      .select({
        action: auditEvents.action,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.action, [
            "EMERGENCY_PROFILE_ENABLED_TRUE_TO_FALSE",
            "EMERGENCY_ACCESS_REVOKED_PROFILE_DISABLED",
          ]),
          inArray(auditEvents.resourceId, [result.requestId, patientId]),
        ),
      );
    expect(
      revocationEvents.filter(
        ({ action }) => action === "EMERGENCY_ACCESS_REVOKED_PROFILE_DISABLED",
      ),
    ).toHaveLength(1);
    expect(
      revocationEvents.some(
        ({ action, resourceId }) =>
          action === "EMERGENCY_PROFILE_ENABLED_TRUE_TO_FALSE" &&
          resourceId === patientId,
      ),
    ).toBe(true);
  });

  it("denies an opted-out patient, records a denial, and rolls back a grant if audit writing fails", async () => {
    const resolutionId = await createResolution(patientUserId);
    await expect(
      service.createRequest(
        edFacilityId,
        {
          resolutionId,
          reasonCode: "PATIENT_UNABLE_TO_CONSENT",
        },
        makeActor(edStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency access unavailable.");
    const [denied] = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
      })
      .from(emergencyAccessRequests)
      .where(
        and(
          eq(emergencyAccessRequests.patientId, patientId),
          eq(emergencyAccessRequests.status, "denied"),
        ),
      );
    expect(denied.status).toBe("denied");
    requestIds.push(denied.id);

    await profileService.update(
      patientId,
      makeActor(patientUserId, "patient"),
      {
        bloodGroup: "B+",
        allergies: ["FAKE patient-declared allergy"],
        emergencyContacts: [],
        enabled: true,
      },
      "127.0.0.1",
    );

    const failingAudit = {
      hashIp: vi.fn(() => "f".repeat(64)),
      logInTransaction: vi
        .fn()
        .mockRejectedValue(new Error("audit unavailable")),
    };
    const serviceWithFailingAudit = new EmergencyAccessService(
      failingAudit,
      resolution,
      notificationsService,
      crypto,
    );
    const pendingOutboxBeforeFailure = await db
      .select({ id: notificationEmailOutbox.id })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.recipientUserId, patientUserId));
    const auditFailureResolution = await createResolution(patientUserId);
    await expect(
      serviceWithFailingAudit.createRequest(
        edFacilityId,
        {
          resolutionId: auditFailureResolution,
          reasonCode: "OTHER_EMERGENCY_CIRCUMSTANCE",
        },
        makeActor(edStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("audit unavailable");

    const grants = await db
      .select({ id: emergencyAccessRequests.id })
      .from(emergencyAccessRequests)
      .where(
        and(
          eq(emergencyAccessRequests.patientId, patientId),
          eq(emergencyAccessRequests.status, "granted"),
        ),
      );
    expect(grants).toHaveLength(0);
    const pendingOutboxAfterFailure = await db
      .select({ id: notificationEmailOutbox.id })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.recipientUserId, patientUserId));
    expect(pendingOutboxAfterFailure).toHaveLength(
      pendingOutboxBeforeFailure.length,
    );
  });

  it("returns no grant when outbox writing fails and rolls back notification and audit rows", async () => {
    const recipients = [patientUserId, guardianUserId];
    const [beforeGrants, beforeNotifications, beforeOutbox, beforeAudits] =
      await Promise.all([
        db
          .select({ id: emergencyAccessRequests.id })
          .from(emergencyAccessRequests)
          .where(
            and(
              eq(emergencyAccessRequests.patientId, patientId),
              eq(emergencyAccessRequests.status, "granted"),
            ),
          ),
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(inArray(notifications.recipientUserId, recipients)),
        db
          .select({ id: notificationEmailOutbox.id })
          .from(notificationEmailOutbox)
          .innerJoin(
            notifications,
            eq(notificationEmailOutbox.notificationId, notifications.id),
          )
          .where(inArray(notifications.recipientUserId, recipients)),
        db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorId, edStaffUserId),
              eq(auditEvents.action, "EMERGENCY_ACCESS_REQUEST_GRANTED"),
            ),
          ),
      ]);

    const failingNotifications = {
      recordForPatientAndGuardians:
        notificationsService.recordForPatientAndGuardians.bind(
          notificationsService,
        ),
      queueEmergencyEmailOutbox: vi
        .fn()
        .mockRejectedValue(new Error("outbox unavailable")),
    };
    const serviceWithFailingOutbox = new EmergencyAccessService(
      audit,
      resolution,
      failingNotifications,
      crypto,
    );
    const resolutionId = await createResolution(patientUserId);
    await expect(
      serviceWithFailingOutbox.createRequest(
        edFacilityId,
        {
          resolutionId,
          reasonCode: "OTHER_EMERGENCY_CIRCUMSTANCE",
        },
        makeActor(edStaffUserId, "emergency-department-staff"),
        "127.0.0.1",
      ),
    ).rejects.toThrow("outbox unavailable");

    const [afterGrants, afterNotifications, afterOutbox, afterAudits] =
      await Promise.all([
        db
          .select({ id: emergencyAccessRequests.id })
          .from(emergencyAccessRequests)
          .where(
            and(
              eq(emergencyAccessRequests.patientId, patientId),
              eq(emergencyAccessRequests.status, "granted"),
            ),
          ),
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(inArray(notifications.recipientUserId, recipients)),
        db
          .select({ id: notificationEmailOutbox.id })
          .from(notificationEmailOutbox)
          .innerJoin(
            notifications,
            eq(notificationEmailOutbox.notificationId, notifications.id),
          )
          .where(inArray(notifications.recipientUserId, recipients)),
        db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorId, edStaffUserId),
              eq(auditEvents.action, "EMERGENCY_ACCESS_REQUEST_GRANTED"),
            ),
          ),
      ]);
    expect(afterGrants).toHaveLength(beforeGrants.length);
    expect(afterNotifications).toHaveLength(beforeNotifications.length);
    expect(afterOutbox).toHaveLength(beforeOutbox.length);
    expect(afterAudits).toHaveLength(beforeAudits.length);
  });

  it("grants access without a deliverable notification channel and flags priority review", async () => {
    const [user] = await db
      .insert(users)
      .values({ role: "patient", status: "suspended" })
      .returning({ id: users.id });
    additionalUserIds.push(user.id);
    const [patient] = await db
      .insert(patients)
      .values({
        userId: user.id,
        healthId: `FAKE-NO-NOTICE-${suffix}`,
        fullName: "Fake Patient Without Notification Channel",
        phoneHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        encryptedPhone: "fake-test-ciphertext",
      })
      .returning({ id: patients.id });
    additionalPatientIds.push(patient.id);

    const profilePayload = Buffer.from(
      JSON.stringify({
        bloodGroup: "unknown",
        allergies: [],
        emergencyContacts: [],
      }),
      "utf8",
    );
    const encrypted = await crypto.encrypt(profilePayload);
    profilePayload.fill(0);
    await db.insert(emergencyProfiles).values({
      patientId: patient.id,
      encryptedPayload: encrypted.ciphertext.toString("base64"),
      wrappedDek: encrypted.wrappedDek,
      kmsKeyId: encrypted.kmsKeyId,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      sha256Plaintext: encrypted.sha256Plaintext,
      enabled: true,
      updatedByUserId: user.id,
    });

    const resolutionId = await createResolution(user.id);
    const result = await service.createRequest(
      edFacilityId,
      {
        resolutionId,
        reasonCode: "OTHER_EMERGENCY_CIRCUMSTANCE",
      },
      makeActor(edStaffUserId, "emergency-department-staff"),
      "127.0.0.1",
    );
    requestIds.push(result.requestId);

    const [grant] = await db
      .select({
        notificationChannelMissing:
          emergencyAccessRequests.notificationChannelMissing,
        priorityReview: emergencyAccessRequests.priorityReview,
      })
      .from(emergencyAccessRequests)
      .where(eq(emergencyAccessRequests.id, result.requestId));
    expect(grant).toEqual({
      notificationChannelMissing: true,
      priorityReview: true,
    });
    const inboxRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.requestId, result.requestId));
    expect(inboxRows).toHaveLength(0);
    const outboxRows = await db
      .select({ id: notificationEmailOutbox.id })
      .from(notificationEmailOutbox)
      .innerJoin(
        notifications,
        eq(notificationEmailOutbox.notificationId, notifications.id),
      )
      .where(eq(notifications.requestId, result.requestId));
    expect(outboxRows).toHaveLength(0);
  });
});
