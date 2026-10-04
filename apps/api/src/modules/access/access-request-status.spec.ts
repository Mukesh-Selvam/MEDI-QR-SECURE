import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";

const mocks = vi.hoisted(() => ({
  results: [] as unknown[],
  select: vi.fn(),
}));

vi.mock("../../database/index.js", () => ({
  db: { select: mocks.select },
}));

function queryBuilder(result: unknown): object {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

import { AccessRequestService } from "./access-request.service.js";

const clinician: AuthenticatedUser = {
  id: "clinician-a",
  sub: "clinician-subject",
  role: "clinician",
  isVerified: true,
};

function createService(): AccessRequestService {
  return new AccessRequestService(
    {} as never,
    {} as never,
    {} as never
  );
}

describe("AccessRequestService request status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results = [];
    mocks.select.mockImplementation(() =>
      queryBuilder(mocks.results.shift())
    );
  });

  it("returns pending without exposing patient information", async () => {
    mocks.results = [[{ clinicianUserId: clinician.id, status: "pending" }]];

    await expect(
      createService().getStatus(clinician, "request-a")
    ).resolves.toEqual({ status: "pending" });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("returns only consent metadata while the request consent is active", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.results = [
      [{ clinicianUserId: clinician.id, status: "approved" }],
      [{
        status: "active",
        scope: ["document:lab"],
        purpose: "clinical-care",
        expiresAt,
      }],
    ];

    await expect(
      createService().getStatus(clinician, "request-a")
    ).resolves.toEqual({
      status: "active",
      scope: ["document:lab"],
      purpose: "clinical-care",
      expiresAt: expiresAt.toISOString(),
    });
  });

  it.each(["revoked", "expired"] as const)(
    "returns %s after consent ends",
    async (status) => {
      mocks.results = [
        [{ clinicianUserId: clinician.id, status: "approved" }],
        [{
          status,
          scope: ["document:lab"],
          purpose: "clinical-care",
          expiresAt: new Date(Date.now() + 60_000),
        }],
      ];

      await expect(
        createService().getStatus(clinician, "request-a")
      ).resolves.toEqual({ status });
    }
  );

  it("does not reveal another clinician's request status", async () => {
    mocks.results = [[{ clinicianUserId: "clinician-b", status: "pending" }]];

    await expect(
      createService().getStatus(clinician, "request-b")
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
