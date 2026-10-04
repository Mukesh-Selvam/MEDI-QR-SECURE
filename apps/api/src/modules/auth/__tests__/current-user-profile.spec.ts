import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../../audit/audit.service.js";
import type { SmsProvider } from "../providers/sms-provider.interface.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  findPatient: vi.fn(),
}));

vi.mock("../../../database/index.js", () => ({
  db: { query: { patients: { findFirst: mocks.findPatient } } },
}));

vi.mock("../../../config/redis.config.js", () => ({
  createRedisClient: () => ({ on: vi.fn(), quit: vi.fn() }),
}));

import { AuthService } from "../auth.service.js";

describe("AuthService current user profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPatient.mockImplementation(() => Promise.resolve(mocks.rows.shift()));
  });

  it("returns the signed-in user's patient record ID from the database", async () => {
    mocks.rows = [{ id: "00000000-0000-0000-0000-000000000003" }];
    const service = new AuthService(
      {} as SmsProvider,
      {} as AuditService
    );
    const user: AuthenticatedUser = {
      id: "00000000-0000-0000-0000-000000000001",
      sub: "subject",
      role: "patient",
    };

    await expect(service.getCurrentUserProfile(user)).resolves.toEqual({
      ...user,
      patientId: "00000000-0000-0000-0000-000000000003",
    });
  });

  it("returns null rather than inventing a patient ID when no patient record exists", async () => {
    mocks.rows = [undefined];
    const service = new AuthService(
      {} as SmsProvider,
      {} as AuditService
    );
    const user: AuthenticatedUser = {
      id: "00000000-0000-0000-0000-000000000001",
      sub: "subject",
      role: "patient",
    };

    await expect(service.getCurrentUserProfile(user)).resolves.toEqual({
      ...user,
      patientId: null,
    });
  });
});
