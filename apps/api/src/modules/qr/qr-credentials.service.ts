import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { patients, qrCredentials } from "../../database/schema.js";
import { env } from "../../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { findPatientOwnerByUserId } from "../auth/patient-access.js";
import {
  createQrCredentialToken,
  hashQrCredentialToken,
  signInAppQrToken,
} from "./qr-token.js";

@Injectable()
export class QrCredentialsService {
  constructor(private readonly audit: AuditService) {}

  async list(userId: string, role: string) {
    const patientId = await this.getPatientId(userId, role);
    return db
      .select({
        id: qrCredentials.id,
        status: qrCredentials.status,
        createdAt: qrCredentials.createdAt,
        rotatedAt: qrCredentials.rotatedAt,
        revokedAt: qrCredentials.revokedAt,
      })
      .from(qrCredentials)
      .where(eq(qrCredentials.patientId, patientId))
      .orderBy(desc(qrCredentials.createdAt));
  }

  async issueOrRotate(
    userId: string,
    role: string,
    ipHash: string
  ): Promise<{ id: string; credentialToken: string }> {
    const patientId = await this.getPatientId(userId, role);
    const credentialToken = createQrCredentialToken();
    const tokenHash = hashQrCredentialToken(credentialToken);
    const now = new Date();

    const result = await db.transaction(async (transaction) => {
      const [active] = await transaction
        .select({ id: qrCredentials.id })
        .from(qrCredentials)
        .where(
          and(
            eq(qrCredentials.patientId, patientId),
            eq(qrCredentials.status, "active")
          )
        )
        .limit(1)
        .for("update");

      if (active) {
        await transaction
          .update(qrCredentials)
          .set({ status: "rotated", rotatedAt: now })
          .where(eq(qrCredentials.id, active.id));
      }

      const [created] = await transaction
        .insert(qrCredentials)
        .values({ patientId, tokenHash })
        .returning({ id: qrCredentials.id });

      const integrityHash = await this.audit.logInTransaction(
        {
          actorId: userId,
          actorRole: role,
          action: active ? "QR_CREDENTIAL_ROTATED" : "QR_CREDENTIAL_ISSUED",
          resourceType: "qr_credential",
          resourceId: created.id,
          outcome: "SUCCESS",
          ipHash,
        },
        transaction
      );

      return { id: created.id, integrityHash };
    });
    this.audit.commitTransactionHash(result.integrityHash);

    return { id: result.id, credentialToken };
  }

  async revoke(
    userId: string,
    role: string,
    credentialId: string,
    ipHash: string
  ): Promise<void> {
    const [patient] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(eq(patients.userId, userId))
      .limit(1);
    if (!patient || role !== "patient") {
      throw new ForbiddenException("Only the patient can revoke this credential");
    }

    const result = await db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(qrCredentials)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(qrCredentials.id, credentialId),
            eq(qrCredentials.patientId, patient.id),
            eq(qrCredentials.status, "active")
          )
        )
        .returning({ id: qrCredentials.id });

      if (!updated) throw new NotFoundException("Active QR credential not found");

      return this.audit.logInTransaction(
        {
          actorId: userId,
          actorRole: role,
          action: "QR_CREDENTIAL_REVOKED",
          resourceType: "qr_credential",
          resourceId: updated.id,
          outcome: "SUCCESS",
          ipHash,
        },
        transaction
      );
    });
    this.audit.commitTransactionHash(result);
  }

  async getInAppToken(
    userId: string,
    role: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const patientId = await this.getPatientId(userId, role);
    const [active] = await db
      .select({ id: qrCredentials.id })
      .from(qrCredentials)
      .where(
        and(
          eq(qrCredentials.patientId, patientId),
          eq(qrCredentials.status, "active")
        )
      )
      .limit(1);

    if (!active) throw new NotFoundException("No active QR credential");
    return signInAppQrToken(active.id, env.HMAC_QR_SIGNING_KEY);
  }

  private async getPatientId(userId: string, role: string): Promise<string> {
    if (role !== "patient") {
      throw new ForbiddenException("QR credentials are available to patients only");
    }
    const patient = await findPatientOwnerByUserId(userId);
    if (!patient) throw new NotFoundException("Patient record not found");
    return patient.id;
  }
}
