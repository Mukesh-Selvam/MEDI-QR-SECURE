import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/index.js";
import {
  auditEvents,
  patients,
  qrCredentials,
  users,
} from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import { QrCredentialsService } from "./qr-credentials.service.js";
import { hashQrCredentialToken } from "./qr-token.js";

describe("QR credential lifecycle (integration)", () => {
  const suffix = randomUUID();
  const userEmail = `qr-${suffix}@mediqr.invalid`;
  let userId: string | undefined;
  let patientId: string | undefined;
  let service: QrCredentialsService;
  let auditIpHash: string;

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

    const audit = new AuditService();
    auditIpHash = audit.hashIp("127.0.0.1");
    service = new QrCredentialsService(audit);
  });

  afterAll(async () => {
    if (patientId) {
      await db.delete(qrCredentials).where(eq(qrCredentials.patientId, patientId));
      await db.delete(patients).where(eq(patients.id, patientId));
    }
    if (userId) {
      await db.delete(auditEvents).where(eq(auditEvents.actorId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
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
});
