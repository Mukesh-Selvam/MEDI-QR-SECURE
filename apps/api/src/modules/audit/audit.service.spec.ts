import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "./audit.service.js";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
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
    mocks.values.mockResolvedValue(undefined);
    const transaction = {
      insert: mocks.insert.mockReturnValue({ values: mocks.values }),
    };
    mocks.transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<string>) =>
        callback(transaction)
    );
  });

  it("inserts the audit event through the active database transaction", async () => {
    const audit = new AuditService();

    await audit.logInTransaction(event);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DOCUMENT_VIEWED",
        resourceId: event.resourceId,
        previousHash: "GENESIS",
      })
    );
  });

  it("propagates insert failures and does not advance the in-memory hash", async () => {
    const audit = new AuditService();
    mocks.values.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(audit.logInTransaction(event)).rejects.toThrow("database unavailable");
    await audit.logInTransaction(event);

    expect(mocks.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ previousHash: "GENESIS" })
    );
  });
});
