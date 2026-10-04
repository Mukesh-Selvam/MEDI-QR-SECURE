import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "./audit.service.js";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("../../database/index.js", () => ({
  db: {
    transaction: mocks.transaction,
    insert: mocks.insert,
  },
}));

const event = {
  actorId: "00000000-0000-0000-0000-000000000001",
  actorRole: "patient",
  action: "DOCUMENT_VIEWED" as const,
  resourceType: "document",
  resourceId: "00000000-0000-0000-0000-000000000002",
  outcome: "SUCCESS" as const,
  ipHash: "a".repeat(64),
};

describe("AuditService.logInTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ integrityHash: "database-chain-hash" }]);
    mocks.values.mockReturnValue({ returning: mocks.returning });
    const transaction = {
      insert: mocks.insert.mockReturnValue({ values: mocks.values }),
    };
    mocks.transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<string>) =>
        callback(transaction)
    );
  });

  it("returns the chain hash assigned by the database trigger", async () => {
    const audit = new AuditService();

    await expect(audit.logInTransaction(event)).resolves.toBe(
      "database-chain-hash"
    );
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DOCUMENT_VIEWED",
        resourceId: event.resourceId,
        previousHash: "GENESIS",
      })
    );
  });

  it("does not hold chain state in the API process after a failed insert", async () => {
    const audit = new AuditService();
    mocks.returning
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([{ integrityHash: "database-chain-hash" }]);

    await expect(audit.logInTransaction(event)).rejects.toThrow(
      "database unavailable"
    );
    await expect(audit.logInTransaction(event)).resolves.toBe(
      "database-chain-hash"
    );
    expect(mocks.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ previousHash: "GENESIS" })
    );
  });
});
