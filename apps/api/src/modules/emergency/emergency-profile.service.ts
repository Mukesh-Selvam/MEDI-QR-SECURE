import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { emergencyProfiles, patients } from "../../database/schema.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { isVerifiedGuardianOfPatient } from "../auth/patient-access.js";
import { AuditService } from "../audit/audit.service.js";
import {
  VaultCryptoService,
  type EncryptResult
} from "../vault/crypto/vault-crypto.service.js";
import {
  emergencyProfileSchema,
  type EmergencyProfileInput
} from "./emergency-profile.schema.js";

type ProfileCrypto = Pick<VaultCryptoService, "encrypt" | "decrypt">;
type ProfileAudit = Pick<AuditService, "hashIp" | "logInTransaction">;
const EMERGENCY_PROFILE_UNAVAILABLE = "Emergency profile unavailable.";

@Injectable()
export class EmergencyProfileService {
  constructor(
    @Inject(VaultCryptoService) private readonly crypto: ProfileCrypto,
    @Inject(AuditService) private readonly audit: ProfileAudit
  ) {}

  async read(
    patientId: string,
    actor: AuthenticatedUser,
    ip: string,
    userAgent: string | undefined
  ): Promise<EmergencyProfileInput & { enabled: boolean }> {
    await this.assertCanManage(patientId, actor);
    return db.transaction(async (transaction) => {
      const [profile] = await transaction
        .select()
        .from(emergencyProfiles)
        .where(eq(emergencyProfiles.patientId, patientId))
        .limit(1);
      let result: EmergencyProfileInput & { enabled: boolean };
      if (!profile) {
        result = {
          bloodGroup: "",
          allergies: [],
          emergencyContacts: [],
          enabled: false
        };
      } else {
        const plaintext = await this.crypto.decrypt({
          ciphertext: Buffer.from(profile.encryptedPayload, "base64"),
          wrappedDek: profile.wrappedDek,
          kmsKeyId: profile.kmsKeyId,
          iv: profile.iv,
          authTag: profile.authTag,
          sha256Plaintext: profile.sha256Plaintext
        });
        try {
          const parsed = emergencyProfileSchema.safeParse({
            ...JSON.parse(plaintext.toString("utf8")),
            enabled: profile.enabled
          });
          if (!parsed.success) {
            throw new Error("Stored emergency profile failed validation.");
          }
          result = parsed.data;
        } finally {
          plaintext.fill(0);
        }
      }

      await this.audit.logInTransaction(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "EMERGENCY_PROFILE_ACCESSED",
          resourceType: "emergency_profile",
          resourceId: patientId,
          outcome: "SUCCESS",
          ipHash: this.audit.hashIp(ip),
          userAgent
        },
        transaction
      );
      return result;
    });
  }

  async update(
    patientId: string,
    actor: AuthenticatedUser,
    input: EmergencyProfileInput,
    ip: string,
    userAgent: string | undefined
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
      const [patient] = await transaction
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.id, patientId))
        .for("update")
        .limit(1);
      if (!patient) throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);

      const [existingProfile] = await transaction
        .select({ enabled: emergencyProfiles.enabled })
        .from(emergencyProfiles)
        .where(eq(emergencyProfiles.patientId, patientId))
        .for("update")
        .limit(1);
      const previousEnabled = existingProfile?.enabled ?? false;
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
          updatedAt: now
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
            updatedAt: now
          }
        })
        .returning({
          patientId: emergencyProfiles.patientId,
          enabled: emergencyProfiles.enabled,
          updatedAt: emergencyProfiles.updatedAt
        });
      if (!profile)
        throw new Error("Emergency profile update returned no record.");

      if (previousEnabled !== enabled) {
        await this.audit.logInTransaction(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: enabled
              ? "EMERGENCY_PROFILE_ENABLED_FALSE_TO_TRUE"
              : "EMERGENCY_PROFILE_ENABLED_TRUE_TO_FALSE",
            resourceType: "emergency_profile",
            resourceId: patientId,
            outcome: "SUCCESS",
            ipHash: this.audit.hashIp(ip),
            userAgent
          },
          transaction
        );
      }
      await this.audit.logInTransaction(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "EMERGENCY_PROFILE_UPDATED",
          resourceType: "emergency_profile",
          resourceId: patientId,
          outcome: "SUCCESS",
          ipHash: this.audit.hashIp(ip),
          userAgent
        },
        transaction
      );
      return profile;
    });
  }

  private async assertCanManage(
    patientId: string,
    actor: AuthenticatedUser
  ): Promise<void> {
    const [patient] = await db
      .select({ id: patients.id, userId: patients.userId })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);
    if (!patient) throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
    if (patient.userId === actor.id && actor.role === "patient") return;
    if (
      actor.role === "guardian" &&
      (await isVerifiedGuardianOfPatient(actor.id, patientId))
    ) {
      return;
    }
    throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
  }
}
