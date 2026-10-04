/**
 * StorageService
 * ==============
 * Thin wrapper around AWS SDK S3 client pointed at MinIO.
 * Provides: put, get, delete, and presigned GET URL generation.
 *
 * Security rules:
 * - Objects stored under randomised UUID-based keys — no patient info in paths.
 * - Presigned URLs expire at exactly PRESIGNED_URL_EXPIRY_SECONDS (300s = 5 min).
 * - Encryption is applied BEFORE this layer; MinIO stores opaque ciphertext.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../../config/env.js";
import { randomUUID } from "crypto";

export const PRESIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes — hard-coded, not configurable

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3!: S3Client;

  onModuleInit(): void {
    this.s3 = new S3Client({
      endpoint: `http${env.STORAGE_USE_SSL ? "s" : ""}://${env.STORAGE_ENDPOINT}:${env.STORAGE_PORT}`,
      region: env.STORAGE_REGION,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    });
    this.logger.log(`[Storage] Connected to ${env.STORAGE_ENDPOINT}:${env.STORAGE_PORT}`);
  }

  /**
   * Generates a random storage key with no patient information.
   * Format: "<prefix>/<uuid>" e.g. "docs/a3f7c123-..."
   */
  generateStorageKey(prefix: string): string {
    return `${prefix}/${randomUUID()}`;
  }

  /**
   * Upload encrypted ciphertext to the quarantine bucket.
   * @returns The storage key used
   */
  async putQuarantine(ciphertext: Buffer, mimeType: string): Promise<string> {
    const key = this.generateStorageKey("q");
    await this.s3.send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET_QUARANTINE,
        Key: key,
        Body: ciphertext,
        ContentType: "application/octet-stream", // Always octet-stream — never expose real MIME of encrypted payload
        Metadata: { "x-mediqr-content-type": mimeType }, // Store original mime safely in metadata
      })
    );
    return key;
  }

  /**
   * Download an object from a bucket into a Buffer.
   */
  async getObject(bucket: string, key: string): Promise<Buffer> {
    const resp = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Copy a key from quarantine → live documents bucket (scan passed).
   */
  async promoteToLive(quarantineKey: string): Promise<string> {
    const liveKey = this.generateStorageKey("d");
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: env.STORAGE_BUCKET_DOCUMENTS,
        Key: liveKey,
        CopySource: `${env.STORAGE_BUCKET_QUARANTINE}/${quarantineKey}`,
      })
    );
    return liveKey;
  }

  /**
   * Delete an object from any bucket.
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Generate a presigned GET URL valid for exactly 5 minutes.
   * The URL is signed and time-bound — no auth header required but cannot be extended.
   */
  async generatePresignedGetUrl(
    bucket: string,
    key: string,
    filename: string,
    mimeType: string
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000);
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `inline; filename="document"`, // Never expose real filename
        ResponseContentType: mimeType,
      }),
      { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS }
    );
    return { url, expiresAt };
    // Suppress unused variable warnings for 'filename' parameter (kept for audit logging outside this function)
    void filename;
  }
}
