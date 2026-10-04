import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/index.js";
import { AuditChainVerifier } from "./audit-chain-verifier.js";
import { AuditService } from "./audit.service.js";

const audit = new AuditService();
const verifier = new AuditChainVerifier();
const opaqueIpHash = "a".repeat(64);

async function appendEvent(): Promise<{ id: string; resourceId: string }> {
  const resourceId = randomUUID();
  await audit.log({
    action: "AUTH_LOGIN_SUCCESS",
    resourceType: "audit_chain_test",
    resourceId,
    outcome: "SUCCESS",
    ipHash: opaqueIpHash,
  });
  const result = await pool.query<{ id: string; event_index: string }>(
    "SELECT id, event_index FROM audit_events WHERE resource_id = $1",
    [resourceId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Test audit event was not persisted");
  return { id: row.id, resourceId };
}

async function appendAdjacentEvents(): Promise<[string, string]> {
  const resourceIds = [randomUUID(), randomUUID()] as const;
  await db.transaction(async (transaction) => {
    for (const resourceId of resourceIds) {
      await audit.logInTransaction(
        {
          action: "AUTH_LOGIN_SUCCESS",
          resourceType: "audit_chain_test",
          resourceId,
          outcome: "SUCCESS",
          ipHash: opaqueIpHash,
        },
        transaction
      );
    }
  });
  return resourceIds;
}

async function inRollbackTransaction(
  operation: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
    await operation(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("PostgreSQL audit chain", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("detects a modified event row", async () => {
    const { id: eventId } = await appendEvent();

    await inRollbackTransaction(async (client) => {
      await client.query("UPDATE audit_events SET action = 'ALTERED' WHERE id = $1", [
        eventId,
      ]);
      const result = await verifier.verify(client);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("integrity_hash_mismatch");
    });
  });

  it("detects a deleted event row", async () => {
    const { id: firstId } = await appendEvent();
    await appendEvent();

    await inRollbackTransaction(async (client) => {
      await client.query("DELETE FROM audit_events WHERE id = $1", [firstId]);
      const result = await verifier.verify(client);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("index_gap");
    });
  });

  it("detects events moved out of their original chain order", async () => {
    const [firstResourceId, secondResourceId] = await appendAdjacentEvents();
    const first = await pool.query<{ event_index: string }>(
      "SELECT id, event_index FROM audit_events WHERE resource_id = $1",
      [firstResourceId]
    );
    const second = await pool.query<{ event_index: string }>(
      "SELECT id, event_index FROM audit_events WHERE resource_id = $1",
      [secondResourceId]
    );
    const firstIndex = Number(first.rows[0]?.event_index);
    const secondIndex = Number(second.rows[0]?.event_index);
    const firstId = first.rows[0]?.id;
    const secondId = second.rows[0]?.id;
    if (!firstId || !secondId) throw new Error("Test audit pair was not persisted");
    expect(secondIndex).toBe(firstIndex + 1);

    await inRollbackTransaction(async (client) => {
      const maximumIndex = await client.query<{ next_index: string }>(
        "SELECT COALESCE(MAX(event_index), 0) + 1 AS next_index FROM audit_events"
      );
      const temporaryIndex = Number(maximumIndex.rows[0]?.next_index);
      await client.query(
        "UPDATE audit_events SET event_index = $1 WHERE id = $2",
        [temporaryIndex, firstId]
      );
      await client.query(
        "UPDATE audit_events SET event_index = $1 WHERE id = $2",
        [firstIndex, secondId]
      );
      await client.query(
        "UPDATE audit_events SET event_index = $1 WHERE id = $2",
        [secondIndex, firstId]
      );
      const result = await verifier.verify(client);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("previous_hash_mismatch");
    });
  });

  it("rejects direct UPDATE and DELETE operations on audit events", async () => {
    const { id: eventId } = await appendEvent();
    const event = await pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE id = $1",
      [eventId]
    );

    await expect(
      pool.query("UPDATE audit_events SET action = 'ALTERED' WHERE id = $1", [
        eventId,
      ])
    ).rejects.toThrow("Audit events are immutable");
    await expect(
      pool.query("DELETE FROM audit_events WHERE id = $1", [eventId])
    ).rejects.toThrow("Audit events are immutable");
    expect((await verifier.verify()).valid).toBe(true);
    expect(event.rows[0]?.action).toBe("AUTH_LOGIN_SUCCESS");
  });

  it("serializes concurrent appends without forking the chain", async () => {
    const appendCount = 20;

    const events = await Promise.all(
      Array.from({ length: appendCount }, () => appendEvent())
    );

    const result = await verifier.verify();
    expect(result.valid).toBe(true);
    const appended = await pool.query<{ event_index: string }>(
      "SELECT event_index FROM audit_events WHERE resource_id = ANY($1::text[])",
      [events.map((event) => event.resourceId)]
    );
    expect(appended.rows).toHaveLength(appendCount);
    expect(new Set(appended.rows.map((event) => event.event_index)).size).toBe(
      appendCount
    );
  });
});
