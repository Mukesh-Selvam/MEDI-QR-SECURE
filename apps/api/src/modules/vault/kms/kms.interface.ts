/**
 * KMS Adapter Interface
 * ====================
 * Abstracts master-key operations for envelope encryption.
 * Swap LocalKmsAdapter for AwsKmsAdapter or GcpKmsAdapter in production
 * with zero changes to callers.
 *
 * Security contract:
 * - Plaintext DEKs are NEVER written to disk or logged.
 * - All DEK material exists only in-memory during wrap/unwrap calls.
 * - The master key (KEK) is read once from env at startup; not stored in DB.
 */

export interface WrappedKey {
  /** Base64-encoded ciphertext of the wrapped DEK */
  wrappedKey: string;
  /** Identifier of the KEK used (alias, ARN, or version) */
  keyId: string;
  /** Algorithm used to wrap the DEK */
  algorithm: string;
}

export interface KmsAdapter {
  /**
   * Wrap (encrypt) a plaintext 256-bit DEK with the master key.
   * @param dek - Raw 32-byte DEK Buffer
   */
  wrapKey(dek: Buffer): Promise<WrappedKey>;

  /**
   * Unwrap (decrypt) a previously wrapped DEK.
   * @param wrappedKey - Base64 ciphertext of the wrapped DEK
   * @param keyId      - The KEK identifier used during wrapping
   * @returns Raw 32-byte DEK Buffer — never log or persist this
   */
  unwrapKey(wrappedKey: string, keyId: string): Promise<Buffer>;
}
