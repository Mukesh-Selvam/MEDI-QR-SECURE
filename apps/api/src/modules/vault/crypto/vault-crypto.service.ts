/**
 * VaultCryptoService
 * ==================
 * Orchestrates envelope encryption for documents:
 *   1. Generates a unique 256-bit DEK per document via crypto.randomBytes.
 *   2. Encrypts the document payload with AES-256-GCM (DEK).
 *   3. Wraps the DEK via KmsAdapter (LocalKmsAdapter in dev, cloud KMS in prod).
 *   4. Computes a SHA-256 plaintext hash for tamper-detection on every read.
 *
 * On decryption:
 *   - Unwraps the DEK from KMS.
 *   - Decrypts the ciphertext with AES-256-GCM (auth tag verified by GCM itself).
 *   - Re-computes SHA-256 of the decrypted plaintext and compares against stored hash.
 *   - If either check fails → TamperDetectedException (throws, caller writes audit alert).
 *
 * Security rules enforced here:
 * - DEKs are NEVER logged, persisted as plaintext, or returned to callers.
 * - All crypto operations use Node.js built-in `crypto` (no third-party crypto libs).
 * - IVs are unique per operation (randomBytes(12) for GCM).
 */

import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { Inject } from "@nestjs/common";
import type { KmsAdapter } from "../kms/kms.interface.js";

export const KMS_ADAPTER_TOKEN = "KMS_ADAPTER";

export interface EncryptResult {
  /** AES-256-GCM ciphertext of the document payload */
  ciphertext: Buffer;
  /** Base64-encoded wrapped DEK (store in document_crypto_keys) */
  wrappedDek: string;
  /** KMS key ID used to wrap the DEK */
  kmsKeyId: string;
  /** Base64-encoded 12-byte GCM IV */
  iv: string;
  /** Base64-encoded 16-byte GCM auth tag */
  authTag: string;
  /** Hex-encoded SHA-256 of the plaintext payload — verified on decryption */
  sha256Plaintext: string;
}

export interface DecryptInput {
  ciphertext: Buffer;
  wrappedDek: string;
  kmsKeyId: string;
  iv: string;
  authTag: string;
  /** Hex SHA-256 stored in document_crypto_keys — must match decrypted plaintext */
  sha256Plaintext: string;
}

@Injectable()
export class VaultCryptoService {
  private readonly logger = new Logger(VaultCryptoService.name);

  constructor(@Inject(KMS_ADAPTER_TOKEN) private readonly kms: KmsAdapter) {}

  /**
   * Encrypts a document payload using envelope encryption.
   * Never logs the plaintext or the DEK.
   */
  async encrypt(plaintext: Buffer): Promise<EncryptResult> {
    // 1. Compute SHA-256 of plaintext for tamper detection
    const sha256Plaintext = createHash("sha256").update(plaintext).digest("hex");

    // 2. Generate a fresh random 256-bit DEK (never reused)
    const dek = randomBytes(32);

    // 3. Generate a random 12-byte IV for AES-256-GCM
    const ivBuf = randomBytes(12);

    // 4. Encrypt payload
    const cipher = createCipheriv("aes-256-gcm", dek, ivBuf);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTagBuf = cipher.getAuthTag();

    // 5. Wrap DEK with KMS master key (never persists raw dek)
    const wrapped = await this.kms.wrapKey(dek);

    // Zero out DEK from memory as soon as wrapping is done
    dek.fill(0);

    return {
      ciphertext,
      wrappedDek: wrapped.wrappedKey,
      kmsKeyId: wrapped.keyId,
      iv: ivBuf.toString("base64"),
      authTag: authTagBuf.toString("base64"),
      sha256Plaintext,
    };
  }

  /**
   * Decrypts a document payload and verifies plaintext integrity.
   * Throws if GCM auth tag or SHA-256 hash do not match.
   * @throws Error with code 'TAMPER_DETECTED' if integrity check fails
   */
  async decrypt(input: DecryptInput): Promise<Buffer> {
    // 1. Unwrap DEK from KMS
    const dek = await this.kms.unwrapKey(input.wrappedDek, input.kmsKeyId);

    const ivBuf = Buffer.from(input.iv, "base64");
    const authTagBuf = Buffer.from(input.authTag, "base64");

    let plaintext: Buffer;
    try {
      // 2. AES-256-GCM decrypt (GCM auth tag check happens here)
      const decipher = createDecipheriv("aes-256-gcm", dek, ivBuf);
      decipher.setAuthTag(authTagBuf);
      plaintext = Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
    } catch {
      // GCM auth tag mismatch — possible tampering
      dek.fill(0);
      this.logger.error("[VaultCrypto] GCM authentication tag verification failed — TAMPER SUSPECTED");
      const err = new Error("Ciphertext authentication failed: TAMPER_DETECTED");
      (err as NodeJS.ErrnoException).code = "TAMPER_DETECTED";
      throw err;
    } finally {
      dek.fill(0);
    }

    // 3. Verify SHA-256 of decrypted plaintext using timing-safe comparison
    const actualHash = createHash("sha256").update(plaintext).digest("hex");
    const expectedHashBuf = Buffer.from(input.sha256Plaintext, "hex");
    const actualHashBuf = Buffer.from(actualHash, "hex");

    if (
      expectedHashBuf.length !== actualHashBuf.length ||
      !timingSafeEqual(expectedHashBuf, actualHashBuf)
    ) {
      this.logger.error("[VaultCrypto] SHA-256 plaintext hash mismatch — TAMPER DETECTED");
      const err = new Error("Document integrity check failed: TAMPER_DETECTED");
      (err as NodeJS.ErrnoException).code = "TAMPER_DETECTED";
      throw err;
    }

    return plaintext;
  }

  /** Compute SHA-256 hex digest of a buffer */
  sha256(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
  }
}
