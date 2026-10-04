import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisClient } from "../../config/redis.config.js";
import { db, pool } from "../../database/index.js";
import {
  accessRequests,
  auditEvents,
  clinicians,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { AuditService } from "../audit/audit.service.js";
import { QrCredentialsService } from "../qr/qr-credentials.service.js";
import { QrResolutionService } from "../qr/qr-resolution.service.js";
import { NoopNotificationEmailProvider } from "../notifications/mailpit-notification-email.provider.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { AccessRequestService } from "./access-request.service.js";
import { createAccessRequestSchema } from "./access-request.schema.js";

describe("Access request creation (integration)", () => {
  const suffix = randomUUID();
  let patientUserId: string | undefined;
  let clinicianUserId: string | undefined;
  let patientId: string | undefined;
  let service: AccessRequestService;
  let credentials: QrCredentialsService;
  let resolution: QrResolutionService;
  let audit: AuditService;

  beforeAll(async () => {
    const migration = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'access_requests'`
    );
    expect(migration.rows).toHaveLength(1);

    const [patientUser] = await db
      .insert(users)
      .values({
        email: `qr-patient-${suffix}@mediqr.invalid`,
        role: "patient",
        status: "active",
      })
      .returning({ id: users.id });
    patientUserId = patientUser.id;

    const [patient] = await db
      .insert(patients)
      .values({
        userId: patientUser.id,
        healthId: `TEST-ACCESS-${suffix}`,
        fullName: "Fake Access Request Patient",
        phoneHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "test-only-ciphertext",
      })
      .returning({ id: patients.id });
    patientId = patient.id;

    const [clinicianUser] = await db
      .insert(users)
      .values({
        email: `qr-clinician-${suffix}@mediqr.invalid`,
        keycloakId: `fake-keycloak-${suffix}`,
        role: "clinician",
        status: "active",
      })
      .returning({ id: users.id });
    clinicianUserId = clinicianUser.id;

    await db.insert(clinicians).values({
      userId: clinicianUser.id,
      fullName: "Fake Verified Clinician",
      registrationNumber: `TEST-${suffix}`,
      stateMedicalCouncil: "Test Council",
      isVerified: true,
    });

    audit = new AuditService();
    const redisClient = createRedisClient();
    resolution = new QrResolutionService(redisClient, audit);
    credentials = new QrCredentialsService(audit);
    service = new AccessRequestService(
      audit,
      resolution,
      new NotificationsService(new NoopNotificationEmailProvider())
    );
  });

  afterAll(async () => {
    if (patientId) {
      await db.delete(accessRequests).where(eq(accessRequests.patientId, patientId));
      await db.delete(qrCredentials).where(eq(qrCredentials.patientId, patientId));
      await db.delete(patients).where(eq(patients.id, patientId));
    }
    if (patientUserId) {
      await db.delete(users).where(eq(users.id, patientUserId));
    }
    if (clinicianUserId) {
      await db
        .delete(clinicians)
        .where(eq(clinicians.userId, clinicianUserId));
      await db.delete(users).where(eq(users.id, clinicianUserId));
    }
    if (resolution) await resolution.onModuleDestroy();
    await pool.end();
  });

  it("creates a pending request using the scanned QR target and audited opaque IDs", async () => {
    const qr = await credentials.issueOrRotate(
      patientUserId!,
      "patient",
      audit.hashIp("127.0.0.1")
    );
    const resolutionId = randomUUID();
    const requestIp = `127.0.0.${Math.floor(Math.random() * 200) + 10}`;
    await resolution.resolve(qr.credentialToken, resolutionId, requestIp);

    const clinician: AuthenticatedUser = {
      id: clinicianUserId!,
      sub: `fake-keycloak-${suffix}`,
      role: "clinician",
      isVerified: true,
    };
    const input = createAccessRequestSchema.parse({
      resolutionId,
      purpose: "clinical-care",
      scope: ["timeline", "document:lab"],
    });
    const result = await service.create(
      clinician,
      input,
      audit.hashIp(requestIp)
    );

    expect(result.status).toBe("pending");
    const [record] = await db
      .select()
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.id, result.requestId),
          eq(accessRequests.patientId, patientId!)
        )
      );
    expect(record.clinicianUserId).toBe(clinicianUserId);
    expect(record.purpose).toBe("clinical-care");
    expect(record.scope).toEqual(["timeline", "document:lab"]);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, clinicianUserId!),
          eq(auditEvents.action, "ACCESS_REQUEST_CREATED"),
          eq(auditEvents.resourceId, result.requestId)
        )
      );
    expect(event.resourceType).toBe("access_request");
    expect(event.resourceId).toBe(result.requestId);
  });

  it("rejects unverified clinicians before consuming a resolution handle", async () => {
    const qr = await credentials.issueOrRotate(
      patientUserId!,
      "patient",
      audit.hashIp("127.0.0.1")
    );
    const resolutionId = randomUUID();
    const requestIp = `127.0.0.${Math.floor(Math.random() * 200) + 10}`;
    await resolution.resolve(qr.credentialToken, resolutionId, requestIp);

    const unverifiedClinician: AuthenticatedUser = {
      id: clinicianUserId!,
      sub: `fake-keycloak-${suffix}`,
      role: "clinician",
      isVerified: false,
    };
    const input = createAccessRequestSchema.parse({
      resolutionId,
      purpose: "clinical-care",
      scope: ["timeline"],
    });

    await expect(
      service.create(unverifiedClinician, input, audit.hashIp(requestIp))
    ).rejects.toThrow(/verified clinician/i);
    expect(await resolution.consumeRequestResolution(resolutionId)).not.toBeNull();
  });
});
