/**
 * FileValidatorService
 * ====================
 * Content-based file type detection and metadata stripping.
 *
 * Rules:
 * 1. Allowed MIME types: application/pdf, image/jpeg, image/png — ONLY.
 * 2. File type is detected from MAGIC BYTES in the file content, NOT from
 *    the file extension or the Content-Type header (both are attacker-controlled).
 * 3. EXIF and ICC metadata is stripped from JPEG and PNG buffers before encryption.
 * 4. File size is checked against MAX_UPLOAD_SIZE_BYTES (default 10 MB).
 *
 * Magic byte signatures:
 *   PDF:  25 50 44 46 ("%PDF")
 *   JPEG: FF D8 FF
 *   PNG:  89 50 4E 47 0D 0A 1A 0A
 */

import { Injectable, BadRequestException } from "@nestjs/common";
import { env } from "../../../config/env.js";

export interface FileValidationResult {
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  cleanedBuffer: Buffer;
  fileSizeBytes: number;
}

/** EICAR test file first 4 bytes — detect it early for test verification */
const EICAR_MAGIC = Buffer.from("58354f21", "hex"); // "X5O!"

@Injectable()
export class FileValidatorService {
  /**
   * Validates file type from magic bytes and strips image metadata.
   * @param buffer - Raw file buffer from upload
   * @param declaredMimeType - MIME type from multipart Content-Type (for logging only, not trusted)
   * @throws BadRequestException if invalid type, too large, or suspicious content
   */
  validate(buffer: Buffer, declaredMimeType?: string): FileValidationResult {
    // 1. Size check first — reject before any processing
    if (buffer.length > env.MAX_UPLOAD_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds maximum allowed size of ${Math.round(env.MAX_UPLOAD_SIZE_BYTES / 1024 / 1024)} MB`
      );
    }

    if (buffer.length < 8) {
      throw new BadRequestException("File is too small to be a valid document");
    }

    // 2. Magic byte detection
    const mimeType = this.detectMimeType(buffer);
    if (!mimeType) {
      throw new BadRequestException(
        `File type not allowed. Only PDF, JPEG, and PNG files are accepted. ` +
        `Declared type was: ${declaredMimeType ?? "unknown"}`
      );
    }

    // 3. Strip metadata from images
    let cleanedBuffer = buffer;
    if (mimeType === "image/jpeg") {
      cleanedBuffer = this.stripJpegExif(buffer);
    } else if (mimeType === "image/png") {
      cleanedBuffer = this.stripPngMetadata(buffer);
    }

    return {
      mimeType,
      cleanedBuffer,
      fileSizeBytes: buffer.length, // original size before strip
    };
  }

  private detectMimeType(buf: Buffer): "application/pdf" | "image/jpeg" | "image/png" | null {
    // PDF: %PDF- (25 50 44 46 2D)
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return "application/pdf";
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return "image/jpeg";
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return "image/png";
    }
    return null;
  }

  /**
   * Strip EXIF / APP1 segments from JPEG.
   * JPEG segments: FF XX [length 2 bytes] [data]
   * We remove APP1 (FF E1) and APP2 (FF E2) segments which carry EXIF/ICC profiles.
   * We keep all other segments (SOI, SOF, SOS, DHT, DQT, EOI).
   */
  private stripJpegExif(buf: Buffer): Buffer {
    const JPEG_SOI = 0xffd8; // Start of Image marker
    const segments: Buffer[] = [];

    // Keep SOI marker
    if (buf.readUInt16BE(0) !== JPEG_SOI) return buf;
    segments.push(buf.subarray(0, 2));

    let offset = 2;
    while (offset < buf.length - 1) {
      if (buf[offset] !== 0xff) break;
      const marker = buf.readUInt16BE(offset);

      // SOS (start of scan) — everything from here is image data
      if (marker === 0xffda) {
        segments.push(buf.subarray(offset));
        break;
      }

      // Markers without a length: EOI, RST0-7, SOI, TEM
      if (marker === 0xffd9 || (marker >= 0xffd0 && marker <= 0xffd7)) {
        segments.push(buf.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }

      if (offset + 4 > buf.length) break;
      const segLen = buf.readUInt16BE(offset + 2) + 2; // includes the length bytes

      // Skip APP1 (EXIF), APP2 (ICC), APP12, APP13 (IPTC)
      const skipMarkers = [0xffe1, 0xffe2, 0xffec, 0xffed];
      if (!skipMarkers.includes(marker)) {
        segments.push(buf.subarray(offset, offset + segLen));
      }

      offset += segLen;
    }

    return Buffer.concat(segments);
  }

  /**
   * Strip metadata chunks from PNG.
   * PNG chunk format: [length 4B][type 4B][data][CRC 4B]
   * We keep: IHDR, IDAT, IEND, PLTE, tRNS (transparency)
   * We remove: tEXt, iTXt, zTXt, eXIf, iCCP (ICC profile), gAMA, cHRM, sRGB, bKGD, hIST, pHYs, sPLT, tIME
   */
  private stripPngMetadata(buf: Buffer): Buffer {
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const KEEP_CHUNKS = new Set(["IHDR", "IDAT", "IEND", "PLTE", "tRNS"]);

    if (!buf.subarray(0, 8).equals(PNG_SIG)) return buf;

    const chunks: Buffer[] = [PNG_SIG];
    let offset = 8;

    while (offset + 12 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
      const totalChunkLen = 4 + 4 + length + 4;

      if (KEEP_CHUNKS.has(type)) {
        chunks.push(buf.subarray(offset, offset + totalChunkLen));
      }

      offset += totalChunkLen;
      if (type === "IEND") break;
    }

    return Buffer.concat(chunks);
  }

  /** Check if buffer starts with EICAR test signature — used in tests */
  isEicarTestFile(buf: Buffer): boolean {
    if (buf.length < 4) return false;
    return buf.subarray(0, 4).equals(EICAR_MAGIC);
  }
}
