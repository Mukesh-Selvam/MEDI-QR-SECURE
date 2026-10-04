/**
 * ClamAvScannerService
 * ====================
 * Streams plaintext (decrypted) buffers to the ClamAV daemon via the
 * INSTREAM TCP protocol (port 3310). Only decrypted-in-memory data is
 * scanned — ciphertext is never passed to ClamAV.
 *
 * Protocol:
 *   nINSTREAM\n
 *   <4-byte big-endian chunk length><chunk data>
 *   <4-byte 0x00000000 (terminator)>
 *
 * Returns: "stream: OK" for clean, "stream: <threat-name> FOUND" for infections.
 *
 * Timeout: CLAMAV_SCAN_TIMEOUT_MS (default 15s)
 */

import { Injectable, Logger } from "@nestjs/common";
import { createConnection } from "net";
import { env } from "../../../config/env.js";

export interface ScanResult {
  clean: boolean;
  /** Name of threat if infected, undefined if clean */
  threatName?: string;
  /** Raw ClamAV response string */
  rawResponse: string;
}

@Injectable()
export class ClamAvScannerService {
  private readonly logger = new Logger(ClamAvScannerService.name);

  /**
   * Scan a plaintext buffer using ClamAV INSTREAM protocol.
   * @param plaintext - Decrypted file buffer (must be plaintext, NOT ciphertext)
   */
  async scan(plaintext: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(
        { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT },
        () => {
          // Send nINSTREAM command
          socket.write("nINSTREAM\n");

          // Send data in chunks (max 4KB per chunk for ClamAV compatibility)
          const CHUNK_SIZE = 4096;
          for (let offset = 0; offset < plaintext.length; offset += CHUNK_SIZE) {
            const chunk = plaintext.subarray(offset, offset + CHUNK_SIZE);
            const lengthBuf = Buffer.allocUnsafe(4);
            lengthBuf.writeUInt32BE(chunk.length, 0);
            socket.write(lengthBuf);
            socket.write(chunk);
          }

          // Zero-length terminator
          const terminator = Buffer.alloc(4);
          socket.write(terminator);
        }
      );

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ClamAV scan timed out after ${env.CLAMAV_SCAN_TIMEOUT_MS}ms`));
      }, env.CLAMAV_SCAN_TIMEOUT_MS);

      let responseData = "";

      socket.on("data", (data: Buffer) => {
        responseData += data.toString("utf8");
      });

      socket.on("end", () => {
        clearTimeout(timeout);
        const raw = responseData.trim();
        this.logger.debug(`[ClamAV] Response: ${raw}`);

        // Parse response: "stream: OK" or "stream: Eicar-Signature FOUND"
        if (raw.endsWith("OK")) {
          resolve({ clean: true, rawResponse: raw });
        } else if (raw.includes("FOUND")) {
          const match = /stream: (.+) FOUND/.exec(raw);
          const threatName = match?.[1] ?? "UnknownThreat";
          this.logger.warn(`[ClamAV] Threat detected: ${threatName}`);
          resolve({ clean: false, threatName, rawResponse: raw });
        } else if (raw.includes("ERROR")) {
          reject(new Error(`ClamAV returned error: ${raw}`));
        } else {
          reject(new Error(`Unexpected ClamAV response: ${raw}`));
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        this.logger.error(`[ClamAV] Connection error: ${err.message}`);
        reject(err);
      });
    });
  }
}
