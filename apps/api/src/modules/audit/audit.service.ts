/**
 * AuditService — tamper-evident, hash-chained audit ledger.
 *
 * Security invariants:
 * 1. Each record includes a SHA-256 hash of the previous record (chain).
 * 2. Actor/resource identifiers are opaque UUIDs only — no PII.
 * 3. IP addresses are HMAC-hashed before storage.
 */
import { Injectable } from "@nestjs/common";
import { createHash, createHmac } from "crypto";
import { db } from "../../database/index.js";
import { auditEvents } from "../../database/schema.js";
import { env } from "../../config/env.js";
import type { AuditEventInput } from "./audit.types.js";

type AuditInsertExecutor = Pick<typeof db, "insert">;

@Injectable()
export class AuditService {
  /** HMAC of the last inserted record hash for chain integrity */
  private lastHash = "GENESIS";

  hashIp(ip: string): string {
    return createHmac("sha256", env.AUDIT_HMAC_KEY).update(ip).digest("hex");
  }

  async log(event: AuditEventInput): Promise<void> {
    this.lastHash = await this.insertEvent(event, db);
  }

  async logInTransaction(
    event: AuditEventInput,
    executor?: AuditInsertExecutor
  ): Promise<string> {
    if (executor) {
      return this.insertEvent(event, executor);
    }
    const integrityHash = await db.transaction((transaction) =>
      this.insertEvent(event, transaction)
    );
    this.lastHash = integrityHash;
    return integrityHash;
  }

  commitTransactionHash(integrityHash: string): void {
    this.lastHash = integrityHash;
  }

  private async insertEvent(
    event: AuditEventInput,
    executor: AuditInsertExecutor
  ): Promise<string> {
    const previousHash = this.lastHash;

    const payload = JSON.stringify({
      ...event,
      previousHash,
      ts: Date.now(),
    });

    const integrityHash = createHash("sha256")
      .update(payload)
      .digest("hex");

    await executor.insert(auditEvents).values({
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      ipHash: event.ipHash,
      userAgent: event.userAgent,
      integrityHash,
      previousHash,
    });
    return integrityHash;
  }
}
