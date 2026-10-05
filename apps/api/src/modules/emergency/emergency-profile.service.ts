import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { emergencyProfiles, patients } from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { isVerifiedGuardianOfPatient } from "../auth/patient-access.js";
import { AuditService } from "../audit/audit.service.js";
import {
  VaultCryptoService,
  type EncryptResult,
} from "../vault/crypto/vault-crypto.service.js";
import {
  emergencyProfileSchema,
  type EmergencyProfileInput,
} from "./emergency-profile.schema.js";

type ProfileCrypto = Pick<VaultCryptoService, "encrypt" | "decrypt">;
type ProfileAudit = Pick<AuditService, "hashIp" | "logInTransaction">;

@Injectable()
export class EmergencyProfileService {
  constructor(
    @Inject(VaultCryptoService) private readonly crypto: ProfileCrypto,
    @Inject(AuditService) private readonly audit: ProfileAudit,
  ) {}

  async read(
    patientId: string,
    actor: AuthenticatedUser,
  ): Promise<EmergencyProfileInput & { enabled: boolean }> {
    await this.assertCanManage(patientId, actor);
    const [profile] = await db
      .select()
      .from(emergencyProfiles)
      .where(eq(emergencyProfiles.patientId, patientId))
      .limit(1);
    if (!profile) {
      return {
        bloodGroup: "",
        allergies: [],
        emergencyContacts: [],
        enabled: false,
      };
    }

    const plaintext = await this.crypto.decrypt({
      ciphertext: Buffer.from(profile.encryptedPayload, "base64"),
      wrappedDek: profile.wrappedDek,
      kmsKeyId: profile.kmsKeyId,
      iv: profile.iv,
      authTag: profile.authTag,
      sha256Plaintext: profile.sha256Plaintext,
    });
    try {
      const parsed = emergencyProfileSchema.safeParse({
        ...JSON.parse(plaintext.toString("utf8")),
        enabled: profile.enabled,
      });
      if (!parsed.success) {
        throw new Error("Stored emergency profile failed validation.");
      }
      return parsed.data;
    } finally {
      plaintext.fill(0);
    }
  }

  async update(
    patientId: string,
    actor: AuthenticatedUser,
    input: EmergencyProfileInput,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ patientId: string; enabled: boolean; updatedAt: Date }> {
    await this.assertCanManage(patientId, actor);
    const { enabled, ...declared } = input;
    const plaintext = Buffer.from(JSON.stringify(declared), "utf8");
    let encrypted: EncryptResult;
    try {
      encrypted = await this.crypto.encrypt(plaintext);
    } finally {
      plaintext.fill(0);
    }
    const now = new Date();

    return db.transaction(async (transaction) => {
      const [profile] = await transaction
        .insert(emergencyProfiles)
        .values({
          patientId,
          encryptedPayload: encrypted.ciphertext.toString("base64"),
          wrappedDek: encrypted.wrappedDek,
          kmsKeyId: encrypted.kmsKeyId,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          sha256Plaintext: encrypted.sha256Plaintext,
          enabled,
          updatedByUserId: actor.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: emergencyProfiles.patientId,
          set: {
            encryptedPayload: encrypted.ciphertext.toString("base64"),
            wrappedDek: encrypted.wrappedDek,
            kmsKeyId: encrypted.kmsKeyId,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            sha256Plaintext: encrypted.sha256Plaintext,
            enabled,
            updatedByUserId: actor.id,
            updatedAt: now,
          },
        })
        .returning({
          patientId: emergencyProfiles.patientId,
          enabled: emergencyProfiles.enabled,
          updatedAt: emergencyProfiles.updatedAt,
        });
      if (!profile)
        throw new Error("Emergency profile update returned no record.");

      await this.audit.logInTransaction(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "EMERGENCY_PROFILE_UPDATED",
          resourceType: "emergency_profile",
          resourceId: patientId,
          outcome: "SUCCESS",
          ipHash: this.audit.hashIp(ip),
          userAgent,
        },
        transaction,
      );
      return profile;
    });
  }

  private async assertCanManage(
    patientId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const [patient] = await db
      .select({ id: patients.id, userId: patients.userId })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);
    if (!patient) throw new NotFoundException("Patient not found.");
    if (patient.userId === actor.id && actor.role === "patient") return;
    if (
      actor.role === "guardian" &&
      (await isVerifiedGuardianOfPatient(actor.id, patientId))
    ) {
      return;
    }
    throw new ForbiddenException(
      "Only the patient or their active guardian can manage this profile.",
    );
  }
}
