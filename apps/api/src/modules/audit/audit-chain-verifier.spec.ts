import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditChainVerifier } from "./audit-chain-verifier.js";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../../database/index.js", () => ({
  pool: { query: mocks.query },
}));

describe("AuditChainVerifier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts an empty chain with the initial database state", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        event_index: null,
        previous_hash: null,
        integrity_hash: null,
        calculated_hash: null,
        last_event_index: "0",
        last_hash: "GENESIS",
      }],
    });

    await expect(new AuditChainVerifier().verify()).resolves.toEqual({
      valid: true,
      eventCount: 0,
    });
  });

  it("reports a mismatch between the chain and its durable database state", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        event_index: null,
        previous_hash: null,
        integrity_hash: null,
        calculated_hash: null,
        last_event_index: "1",
        last_hash: "unexpected",
      }],
    });

    await expect(new AuditChainVerifier().verify()).resolves.toEqual({
      valid: false,
      eventCount: 0,
      reason: "state_mismatch",
    });
  });
});
