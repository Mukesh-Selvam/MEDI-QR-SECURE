/**
 * Vault Crypto Round-Trip & Tamper Detection Tests
 * =================================================
 * Verifies:
 * 1. Encrypt → Decrypt produces identical plaintext.
 * 2. Tamper 1 byte of ciphertext → GCM auth tag fails (TAMPER_DETECTED).
 * 3. Tamper stored SHA-256 hash → integrity check fails (TAMPER_DETECTED).
 * 4. LocalKmsAdapter wrap/unwrap round-trips correctly.
 * 5. LocalKmsAdapter refuses to init in production.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { VaultCryptoService } from "../crypto/vault-crypto.service.js";
import { LocalKmsAdapter } from "../kms/local-kms.adapter.js";

const testEnv = vi.hoisted(() => ({
  NODE_ENV: "test" as string,
  KMS_MASTER_KEY: Buffer.alloc(32, 0x01).toString("hex"),
}));
vi.mock("../../../config/env.js", () => ({ env: testEnv }));

import { env } from "../../../config/env.js";

// --- Helper to build the service under test ---
function buildCryptoService(): VaultCryptoService {
  const kms = new LocalKmsAdapter();
  env.NODE_ENV = "development";
  kms.onModuleInit();
  const svc = new VaultCryptoService(kms);
  return svc;
}

describe("VaultCryptoService", () => {
  let svc: VaultCryptoService;

  beforeEach(() => {
    svc = buildCryptoService();
  });

  it("encrypts and decrypts to produce identical plaintext", async () => {
    const plaintext = Buffer.from("Hello MediQR — sensitive document payload!");
    const encrypted = await svc.encrypt(plaintext);

    expect(encrypted.ciphertext).not.toEqual(plaintext);
    expect(encrypted.sha256Plaintext).toHaveLength(64); // hex SHA-256

    const decrypted = await svc.decrypt({
      ciphertext: encrypted.ciphertext,
      wrappedDek: encrypted.wrappedDek,
      kmsKeyId: encrypted.kmsKeyId,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      sha256Plaintext: encrypted.sha256Plaintext,
    });

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("rejects tampered ciphertext (GCM auth tag mismatch → TAMPER_DETECTED)", async () => {
    const plaintext = Buffer.from("Sensitive clinical data for tamper test");
    const encrypted = await svc.encrypt(plaintext);

    // Flip a bit in the ciphertext
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] ^= 0xff;

    await expect(
      svc.decrypt({
        ciphertext: tampered,
        wrappedDek: encrypted.wrappedDek,
        kmsKeyId: encrypted.kmsKeyId,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        sha256Plaintext: encrypted.sha256Plaintext,
      })
    ).rejects.toMatchObject({ code: "TAMPER_DETECTED" });
  });

  it("rejects truncated GCM authentication tags", async () => {
    const encrypted = await svc.encrypt(Buffer.from("Authentication tag length test"));
    const truncatedTag = Buffer.from(encrypted.authTag, "base64")
      .subarray(0, 12)
      .toString("base64");

    await expect(
      svc.decrypt({
        ciphertext: encrypted.ciphertext,
        wrappedDek: encrypted.wrappedDek,
        kmsKeyId: encrypted.kmsKeyId,
        iv: encrypted.iv,
        authTag: truncatedTag,
        sha256Plaintext: encrypted.sha256Plaintext,
      })
    ).rejects.toMatchObject({ code: "TAMPER_DETECTED" });
  });

  it("rejects tampered SHA-256 hash even when ciphertext is valid (integrity check)", async () => {
    const plaintext = Buffer.from("Medical prescription content");
    const encrypted = await svc.encrypt(plaintext);

    // Corrupt the stored hash
    const badHash = "a".repeat(64);

    await expect(
      svc.decrypt({
        ciphertext: encrypted.ciphertext,
        wrappedDek: encrypted.wrappedDek,
        kmsKeyId: encrypted.kmsKeyId,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        sha256Plaintext: badHash,
      })
    ).rejects.toMatchObject({ code: "TAMPER_DETECTED" });
  });

  it("produces a unique DEK per encryption (ciphertexts differ for same plaintext)", async () => {
    const plaintext = Buffer.from("Same data, different keys");
    const enc1 = await svc.encrypt(plaintext);
    const enc2 = await svc.encrypt(plaintext);

    // Same plaintext → different ciphertexts (unique IV + DEK per call)
    expect(enc1.ciphertext.equals(enc2.ciphertext)).toBe(false);
    expect(enc1.iv).not.toEqual(enc2.iv);
    // But same SHA-256 of plaintext
    expect(enc1.sha256Plaintext).toEqual(enc2.sha256Plaintext);
  });

  it("sha256() helper produces correct hex hash", () => {
    const buf = Buffer.from("test");
    const hash = svc.sha256(buf);
    // SHA-256 of "test" is well-known
    expect(hash).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
});

describe("LocalKmsAdapter", () => {
  it("wraps and unwraps a DEK round-trip", async () => {
    process.env["KMS_MASTER_KEY"] = Buffer.alloc(32, 0x01).toString("hex");
    process.env["NODE_ENV"] = "development";

    const adapter = new LocalKmsAdapter();
    adapter.onModuleInit();

    const dek = Buffer.from("0123456789abcdef0123456789abcdef", "hex"); // 16 bytes for test
    const wrapped = await adapter.wrapKey(dek);

    expect(wrapped.wrappedKey).toBeTruthy();
    expect(wrapped.keyId).toBe("local-master-k1");

    const unwrapped = await adapter.unwrapKey(wrapped.wrappedKey, wrapped.keyId);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("rejects a truncated wrapped-key authentication tag", async () => {
    process.env["KMS_MASTER_KEY"] = Buffer.alloc(32, 0x01).toString("hex");
    process.env["NODE_ENV"] = "development";

    const adapter = new LocalKmsAdapter();
    adapter.onModuleInit();
    const wrapped = await adapter.wrapKey(Buffer.from("wrapped key test"));
    const payload = JSON.parse(Buffer.from(wrapped.wrappedKey, "base64").toString("utf8")) as {
      at: string;
    };
    payload.at = Buffer.from(payload.at, "hex").subarray(0, 12).toString("hex");
    const truncatedWrappedKey = Buffer.from(JSON.stringify(payload)).toString("base64");

    await expect(adapter.unwrapKey(truncatedWrappedKey, wrapped.keyId)).rejects.toThrow();
  });

  it("refuses to initialize in production", () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const adapter = new LocalKmsAdapter();
      expect(() => adapter.onModuleInit()).toThrow(/LocalKmsAdapter is a dev-only KMS adapter/);
    } finally {
      env.NODE_ENV = original;
    }
  });
});
