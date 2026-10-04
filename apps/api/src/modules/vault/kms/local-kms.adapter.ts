/**
 * Local KMS Adapter (Development / CI use only)
 * ===============================================
 * Implements KmsAdapter using AES-256-GCM to wrap/unwrap DEKs
 * with a master key loaded from KMS_MASTER_KEY env variable.
 *
 * This adapter MUST NOT run in production. The assertProductionAuthSafety()
 * equivalent for the vault module rejects this adapter when NODE_ENV=production.
 *
 * Wire format for wrappedKey (Base64-encoded JSON):
 *   { kiv: "<12-byte GCM IV hex>", ct: "<ciphertext hex>", at: "<16-byte auth tag hex>" }
 *
 * In production, replace with:
 *   - AwsKmsAdapter  → kms:Encrypt / kms:Decrypt
 *   - GcpKmsAdapter  → cloudkms.cryptoKeyVersions.asymmetricDecrypt
 *   - VaultKmsAdapter → HashiCorp Vault Transit secrets engine
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { KmsAdapter, WrappedKey } from "./kms.interface.js";
import { env } from "../../../config/env.js";

export const LOCAL_KMS_KEY_ID = "local-master-k1";

@Injectable()
export class LocalKmsAdapter implements KmsAdapter, OnModuleInit {
  private readonly logger = new Logger(LocalKmsAdapter.name);
  private masterKey!: Buffer;

  onModuleInit(): void {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: LocalKmsAdapter is a dev-only KMS adapter and MUST NOT be used in production. " +
        "Configure a cloud KMS adapter (AWS KMS, GCP Cloud KMS, HashiCorp Vault) instead."
      );
    }
    this.masterKey = Buffer.from(env.KMS_MASTER_KEY, "hex");
    this.logger.warn(
      "[LocalKmsAdapter] Using LOCAL dev KMS — NOT suitable for production. " +
      "Switch to a cloud KMS adapter before deploying."
    );
  }

  async wrapKey(dek: Buffer): Promise<WrappedKey> {
    // Generate a random 12-byte IV for wrapping
    const kiv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, kiv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const at = cipher.getAuthTag();

    // Encode as compact JSON → Base64 so the DB column stays string-typed
    const payload = JSON.stringify({
      kiv: kiv.toString("hex"),
      ct: ct.toString("hex"),
      at: at.toString("hex"),
    });

    return {
      wrappedKey: Buffer.from(payload).toString("base64"),
      keyId: LOCAL_KMS_KEY_ID,
      algorithm: "aes-256-gcm-keywrap",
    };
  }

  async unwrapKey(wrappedKey: string, _keyId: string): Promise<Buffer> {
    const payload = JSON.parse(Buffer.from(wrappedKey, "base64").toString("utf8")) as {
      kiv: string;
      ct: string;
      at: string;
    };

    const kiv = Buffer.from(payload.kiv, "hex");
    const ct = Buffer.from(payload.ct, "hex");
    const at = Buffer.from(payload.at, "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, kiv);
    decipher.setAuthTag(at);

    const dek = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dek;
  }
}
