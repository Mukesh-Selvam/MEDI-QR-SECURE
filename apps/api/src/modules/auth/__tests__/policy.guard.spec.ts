import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";
import { POLICY_KEY } from "../decorators/policy.decorator.js";
import { PolicyGuard } from "../guards/policy.guard.js";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";

const mocks = vi.hoisted(() => ({
  queryResults: [] as unknown[],
  checkResource: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../../database/index.js", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("../../../config/env.js", () => ({
  env: { CERBOS_HOST: "127.0.0.1", CERBOS_PORT: 3593 },
}));

vi.mock("@cerbos/grpc", () => ({
  GRPC: vi.fn().mockImplementation(() => ({
    checkResource: mocks.checkResource,
  })),
}));

function queryBuilder(result: unknown): object {
  const builder = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  builder.from.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  return builder;
}

function createContext(
  reflector: Reflector,
  user: AuthenticatedUser,
  params: Record<string, string>,
  resource = "document",
  action = "read"
): ExecutionContext {
  vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key: string) => {
    if (key === PUBLIC_ROUTE_KEY) return false;
    if (key === POLICY_KEY) return { resource, action };
    return undefined;
  });
  const request = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const patientA: AuthenticatedUser = {
  id: "user-a",
  sub: "subject-a",
  role: "patient",
};

describe("PolicyGuard patient and guardian ownership resolution", () => {
  let reflector: Reflector;
  let guard: PolicyGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryResults = [];
    mocks.select.mockImplementation(() => queryBuilder(mocks.queryResults.shift()));
    mocks.checkResource.mockImplementation(async (input: {
      principal: { id: string; attributes: { guardian_ward_ids: string[] } };
      resource: { attributes: { owner_id: string } };
    }) => ({
      isAllowed: () =>
        input.principal.id === input.resource.attributes.owner_id ||
        input.principal.attributes.guardian_ward_ids.includes(input.resource.attributes.owner_id),
    }));
    reflector = new Reflector();
    guard = new PolicyGuard(reflector);
  });

  it("denies patient A access to patient B's timeline using the database owner", async () => {
    mocks.queryResults = [[{ id: "patient-b", ownerUserId: "user-b" }]];
    const context = createContext(reflector, patientA, { patientId: "patient-b" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ id: "user-a" }),
        resource: expect.objectContaining({
          attributes: { owner_id: "user-b", patient_id: "patient-b" },
        }),
      })
    );
  });

  it("denies patient A access to patient B's document", async () => {
    mocks.queryResults = [
      [{ patientId: "patient-b" }],
      [{ id: "patient-b", ownerUserId: "user-b" }],
    ];
    const context = createContext(reflector, patientA, { id: "document-b" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: "document-b",
          attributes: { owner_id: "user-b", patient_id: "patient-b" },
        }),
      })
    );
  });

  it("allows a guardian to read only a verified, unexpired child's document", async () => {
    const guardian: AuthenticatedUser = {
      id: "guardian-user",
      sub: "guardian-sub",
      role: "guardian",
    };
    mocks.queryResults = [
      [{ patientId: "child-a" }],
      [{ id: "child-a", ownerUserId: "child-user-a" }],
      [{ ownerUserId: "child-user-a" }],
    ];
    const context = createContext(reflector, guardian, { id: "child-document" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          attributes: expect.objectContaining({ guardian_ward_ids: ["child-user-a"] }),
        }),
        resource: expect.objectContaining({
          attributes: { owner_id: "child-user-a", patient_id: "child-a" },
        }),
      })
    );
  });

  it("denies a guardian a child's document when no verified guardianship exists", async () => {
    const guardian: AuthenticatedUser = {
      id: "guardian-user",
      sub: "guardian-sub",
      role: "guardian",
    };
    mocks.queryResults = [
      [{ patientId: "child-b" }],
      [{ id: "child-b", ownerUserId: "child-user-b" }],
      [],
    ];
    const context = createContext(reflector, guardian, { id: "child-b-document" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("never passes a client-controlled patient or document ID as owner_id", async () => {
    mocks.queryResults = [
      [{ patientId: "client-patient-id" }],
      [{ id: "client-patient-id", ownerUserId: "database-owner-id" }],
    ];
    const context = createContext(reflector, patientA, { id: "client-document-id" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    const request = mocks.checkResource.mock.calls[0]?.[0] as {
      resource: { attributes: { owner_id: string } };
    };
    expect(request.resource.attributes.owner_id).toBe("database-owner-id");
    expect(request.resource.attributes.owner_id).not.toBe("client-document-id");
  });
});
