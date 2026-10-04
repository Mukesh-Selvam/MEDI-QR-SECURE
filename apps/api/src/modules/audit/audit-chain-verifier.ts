import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { pool } from "../../database/index.js";

const GENESIS_HASH = "GENESIS";
const VERIFICATION_INTERVAL_MS = 5 * 60 * 1000;

interface AuditChainRow {
  event_index: string | number | null;
  previous_hash: string | null;
  integrity_hash: string | null;
  calculated_hash: string | null;
  last_event_index: string | number;
  last_hash: string;
}

export interface AuditChainVerification {
  valid: boolean;
  eventCount: number;
  reason?: "index_gap" | "previous_hash_mismatch" | "integrity_hash_mismatch" | "state_mismatch";
  eventIndex?: number;
}

@Injectable()
export class AuditChainVerifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditChainVerifier.name);
  private timer: NodeJS.Timeout | undefined;

  onModuleInit(): void {
    void this.verifyAndAlert();
    this.timer = setInterval(() => void this.verifyAndAlert(), VERIFICATION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async verify(queryable: Pool | PoolClient = pool): Promise<AuditChainVerification> {
    const result = await queryable.query<AuditChainRow>(
      `SELECT event.event_index, event.previous_hash, event.integrity_hash,
              encode(digest(convert_to(audit_event_canonical_content(
                event.id, event.event_index, event.timestamp, event.actor_id,
                event.actor_role, event.action, event.resource_type,
                event.resource_id, event.outcome::TEXT, event.ip_hash,
                event.user_agent, event.previous_hash
              ), 'UTF8'), 'sha256'), 'hex') AS calculated_hash
              , state.last_event_index, state.last_hash
       FROM audit_chain_state AS state
       LEFT JOIN audit_events AS event ON TRUE
       WHERE state.singleton = TRUE
       ORDER BY event.event_index`
    );

    let previousHash = GENESIS_HASH;
    let expectedIndex = 1;
    for (const event of result.rows) {
      if (event.event_index === null) continue;
      const eventIndex = Number(event.event_index);
      if (
        event.previous_hash === null ||
        event.integrity_hash === null ||
        event.calculated_hash === null
      ) {
        return { valid: false, eventCount: expectedIndex - 1, eventIndex, reason: "integrity_hash_mismatch" };
      }
      if (eventIndex !== expectedIndex) {
        return { valid: false, eventCount: expectedIndex - 1, eventIndex, reason: "index_gap" };
      }
      if (event.previous_hash !== previousHash) {
        return { valid: false, eventCount: expectedIndex - 1, eventIndex, reason: "previous_hash_mismatch" };
      }
      if (event.integrity_hash !== event.calculated_hash) {
        return { valid: false, eventCount: expectedIndex - 1, eventIndex, reason: "integrity_hash_mismatch" };
      }
      previousHash = event.integrity_hash;
      expectedIndex += 1;
    }

    const chainState = result.rows[0];
    if (
      !chainState ||
      Number(chainState.last_event_index) !== expectedIndex - 1 ||
      chainState.last_hash !== previousHash
    ) {
      return { valid: false, eventCount: expectedIndex - 1, reason: "state_mismatch" };
    }

    return { valid: true, eventCount: expectedIndex - 1 };
  }

  private async verifyAndAlert(): Promise<void> {
    try {
      const result = await this.verify();
      if (!result.valid) {
        this.logger.error(
          `Audit chain verification failed at event index ${result.eventIndex ?? "unknown"} (${result.reason ?? "unknown"}).`
        );
      }
    } catch {
      this.logger.error("Audit chain verification could not complete.");
    }
  }
}
