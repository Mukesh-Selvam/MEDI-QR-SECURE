/**
 * AuditService — tamper-evident, hash-chained audit ledger.
 *
 * Security invariants:
 * 1. Each record includes a SHA-256 hash of the previous record (chain).
 * 2. Actor/resource identifiers are opaque UUIDs only — no PII.
 * 3. IP addresses are HMAC-hashed before storage.
 */
import { Injectable } from "@nestjs/common";
import { createHmac } from "crypto";
import { db } from "../../database/index.js";
import { auditEvents } from "../../database/schema.js";
import { env } from "../../config/env.js";
import type { AuditEventInput } from "./audit.types.js";

type AuditInsertExecutor = Pick<typeof db, "insert">;

@Injectable()
export class AuditService {
  hashIp(ip: string): string {
    return createHmac("sha256", env.AUDIT_HMAC_KEY).update(ip).digest("hex");
  }

  async log(event: AuditEventInput): Promise<void> {
    await this.logInTransaction(event);
  }

  async logInTransaction(
    event: AuditEventInput,
    executor?: AuditInsertExecutor
  ): Promise<string> {
    if (executor) {
      return this.insertEvent(event, executor);
    }
    return db.transaction((transaction) =>
      this.insertEvent(event, transaction)
    );
  }

  private async insertEvent(
    event: AuditEventInput,
    executor: AuditInsertExecutor
  ): Promise<string> {
    const [inserted] = await executor.insert(auditEvents).values({
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      ipHash: event.ipHash,
      userAgent: event.userAgent,
      integrityHash: "0".repeat(64),
      previousHash: "GENESIS",
    }).returning({ integrityHash: auditEvents.integrityHash });
    if (!inserted) throw new Error("Audit event insert returned no chain hash");
    return inserted.integrityHash;
  }
}
