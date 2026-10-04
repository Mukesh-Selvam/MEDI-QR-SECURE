import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisClient } from "../../config/redis.config.js";
import { env } from "../../config/env.js";
import { db, pool } from "../../database/index.js";
import {
  auditEvents,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import { QrCredentialsService } from "./qr-credentials.service.js";
import { QrResolutionService } from "./qr-resolution.service.js";
import { hashQrCredentialToken, signInAppQrToken } from "./qr-token.js";

describe("QR credential lifecycle (integration)", () => {
  const suffix = randomUUID();
  const userEmail = `qr-${suffix}@mediqr.invalid`;
  let userId: string | undefined;
  let patientId: string | undefined;
  let service: QrCredentialsService;
  let resolution: QrResolutionService;
  let audit: AuditService;
  let auditIpHash: string;
  const resolutionAuditIds: string[] = [];

  beforeAll(async () => {
    const migration = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'qr_credentials'`
    );
    expect(migration.rows).toHaveLength(1);

    const [user] = await db
      .insert(users)
      .values({ email: userEmail, role: "patient", status: "active" })
      .returning({ id: users.id });
    userId = user.id;

    const [patient] = await db
      .insert(patients)
      .values({
        userId: user.id,
        healthId: `TEST-${suffix}`,
        fullName: "Fake QR Patient",
        phoneHash: createHash("sha256").update(suffix).digest("hex"),
        encryptedPhone: "test-only-ciphertext",
      })
      .returning({ id: patients.id });
    patientId = patient.id;

    audit = new AuditService();
    auditIpHash = audit.hashIp("127.0.0.1");
    service = new QrCredentialsService(audit);
    resolution = new QrResolutionService(createRedisClient(), audit);
  });

  afterAll(async () => {
    if (patientId) {
      await db.delete(qrCredentials).where(eq(qrCredentials.patientId, patientId));
      await db.delete(patients).where(eq(patients.id, patientId));
    }
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await resolution?.onModuleDestroy();
    await pool.end();
  });

  it("persists only a token hash and rotates/revokes prior credentials", async () => {
    const first = await service.issueOrRotate(userId!, "patient", auditIpHash);
    const [firstRow] = await db
      .select()
      .from(qrCredentials)
      .where(eq(qrCredentials.id, first.id));

    expect(firstRow.tokenHash).toBe(hashQrCredentialToken(first.credentialToken));
    expect(firstRow.tokenHash).not.toContain(first.credentialToken);
    expect(firstRow.status).toBe("active");

    const second = await service.issueOrRotate(userId!, "patient", auditIpHash);
    const [rotatedFirst] = await db
      .select()
      .from(qrCredentials)
      .where(eq(qrCredentials.id, first.id));
    expect(rotatedFirst.status).toBe("rotated");

    await service.revoke(userId!, "patient", second.id, auditIpHash);
    const [revokedSecond] = await db
      .select()
      .from(qrCredentials)
      .where(and(eq(qrCredentials.id, second.id), eq(qrCredentials.patientId, patientId!)));
    expect(revokedSecond.status).toBe("revoked");

    const events = await db
      .select({ action: auditEvents.action, resourceId: auditEvents.resourceId })
      .from(auditEvents)
      .where(eq(auditEvents.actorId, userId!));
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "QR_CREDENTIAL_ISSUED",
        "QR_CREDENTIAL_ROTATED",
        "QR_CREDENTIAL_REVOKED",
      ])
    );
    expect(events.every((event) => event.resourceId !== userEmail)).toBe(true);
  });

  it("resolves only active credentials and rejects expired, rotated, and replayed QR tokens", async () => {
    const first = await service.issueOrRotate(userId!, "patient", auditIpHash);
    const staticResolutionId = randomUUID();
    resolutionAuditIds.push(staticResolutionId);
    const requestIp = `127.0.0.${Math.floor(Math.random() * 200) + 10}`;
    await resolution.resolve(first.credentialToken, staticResolutionId, requestIp);
    expect(await resolution.consumeRequestResolution(staticResolutionId)).toBe(first.id);

    const staleSignedQr = await service.getInAppToken(userId!, "patient");
    const second = await service.issueOrRotate(userId!, "patient", auditIpHash);
    const staleResolutionId = randomUUID();
    resolutionAuditIds.push(staleResolutionId);
    await resolution.resolve(staleSignedQr.token, staleResolutionId, requestIp);
    expect(await resolution.consumeRequestResolution(staleResolutionId)).toBeNull();

    const activeSignedQr = await service.getInAppToken(userId!, "patient");
    const activeResolutionId = randomUUID();
    resolutionAuditIds.push(activeResolutionId);
    await resolution.resolve(activeSignedQr.token, activeResolutionId, requestIp);
    expect(await resolution.consumeRequestResolution(activeResolutionId)).toBe(second.id);

    const replayedResolutionId = randomUUID();
    resolutionAuditIds.push(replayedResolutionId);
    await resolution.resolve(activeSignedQr.token, replayedResolutionId, requestIp);
    expect(await resolution.consumeRequestResolution(replayedResolutionId)).toBeNull();

    const revokedCredential = await service.issueOrRotate(userId!, "patient", auditIpHash);
    await service.revoke(userId!, "patient", revokedCredential.id, auditIpHash);
    const revokedResolutionId = randomUUID();
    resolutionAuditIds.push(revokedResolutionId);
    await resolution.resolve(
      revokedCredential.credentialToken,
      revokedResolutionId,
      requestIp
    );

    const expired = await signInAppQrToken(
      "missing-credential",
      env.HMAC_QR_SIGNING_KEY,
      new Date(Date.now() - 120_000)
    );
    const unknownToken = randomUUID().replaceAll("-", "").slice(0, 22);
    const expiredResolutionId = randomUUID();
    const unknownResolutionId = randomUUID();
    resolutionAuditIds.push(expiredResolutionId, unknownResolutionId);
    await resolution.resolve(expired.token, expiredResolutionId, requestIp);
    await resolution.resolve(unknownToken, unknownResolutionId, requestIp);
    expect(await resolution.consumeRequestResolution(expiredResolutionId)).toBeNull();
    expect(await resolution.consumeRequestResolution(unknownResolutionId)).toBeNull();

    const resolutionEvents = await db
      .select({
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        resourceId: auditEvents.resourceId,
        ipHash: auditEvents.ipHash,
      })
      .from(auditEvents)
      .where(inArray(auditEvents.resourceId, resolutionAuditIds));
    expect(resolutionEvents).toHaveLength(resolutionAuditIds.length);
    expect(resolutionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "QR_RESOLUTION_SUCCESS",
          outcome: "SUCCESS",
          resourceId: staticResolutionId,
        }),
        expect.objectContaining({
          action: "QR_RESOLUTION_EXPIRED",
          outcome: "DENIED",
          resourceId: staleResolutionId,
        }),
        expect.objectContaining({
          action: "QR_RESOLUTION_REPLAYED",
          outcome: "DENIED",
          resourceId: replayedResolutionId,
        }),
        expect.objectContaining({
          action: "QR_RESOLUTION_REVOKED",
          outcome: "DENIED",
          resourceId: revokedResolutionId,
        }),
        expect.objectContaining({
          action: "QR_RESOLUTION_EXPIRED",
          outcome: "DENIED",
          resourceId: expiredResolutionId,
        }),
        expect.objectContaining({
          action: "QR_RESOLUTION_UNKNOWN",
          outcome: "DENIED",
          resourceId: unknownResolutionId,
        }),
      ])
    );
    expect(
      resolutionEvents.every((event) => event.ipHash === audit.hashIp(requestIp))
    ).toBe(true);
    expect(
      resolutionEvents.every((event) => event.resourceId !== userEmail)
    ).toBe(true);
  });
});
