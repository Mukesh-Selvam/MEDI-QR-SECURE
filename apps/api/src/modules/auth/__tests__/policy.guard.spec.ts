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
  action = "read",
  headers: Record<string, string> = {}
): ExecutionContext {
  vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key: string) => {
    if (key === PUBLIC_ROUTE_KEY) return false;
    if (key === POLICY_KEY) return { resource, action };
    return undefined;
  });
  const request = { params, headers, user };
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
      principal: {
        id: string;
        attributes: {
          guardian_ward_ids: string[];
          has_patient_relationship: boolean;
        };
      };
      resource: { attributes: { owner_id: string } };
    }) => ({
      isAllowed: () =>
        input.principal.id === input.resource.attributes.owner_id ||
        input.principal.attributes.guardian_ward_ids.includes(input.resource.attributes.owner_id) ||
        input.principal.attributes.has_patient_relationship,
    }));
    reflector = new Reflector();
    guard = new PolicyGuard(reflector);
  });

  it("denies patient A access to patient B's timeline using the database owner", async () => {
    mocks.queryResults = [[{ id: "patient-b", userId: "user-b" }]];
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

  it("resolves a patient's own profile as the resource for credential management", async () => {
    mocks.queryResults = [[{ id: "patient-a", userId: "user-a" }]];
    const context = createContext(reflector, patientA, {}, "patient", "update");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: "patient-a",
          attributes: { owner_id: "user-a", patient_id: "patient-a" },
        }),
      })
    );
  });

  it("denies patient A access to patient B's document", async () => {
    mocks.queryResults = [
      [{ patientId: "patient-b" }],
      [{ id: "patient-b", userId: "user-b" }],
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

  it("resolves a clinician records request to its database patient and active consent", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    mocks.queryResults = [
      [{
        patientId: "patient-a",
        scope: ["document:lab"],
        purpose: "clinical-care",
        expiresAt: new Date(Date.now() + 60_000),
      }],
      [{ id: "patient-a", userId: "patient-user-a" }],
    ];
    mocks.checkResource.mockResolvedValue({ isAllowed: () => true });
    const context = createContext(
      reflector,
      clinician,
      { requestId: "request-a" }
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: "request-a",
          attributes: {
            owner_id: "patient-user-a",
            patient_id: "patient-a",
          },
        }),
        principal: expect.objectContaining({
          attributes: expect.objectContaining({
            has_consent_grant: true,
            has_scope: true,
          }),
        }),
      })
    );
  });

  it("denies a clinician whose request has no active request-bound consent", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    mocks.queryResults = [[]];
    const context = createContext(
      reflector,
      clinician,
      { requestId: "request-without-consent" }
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(mocks.checkResource).not.toHaveBeenCalled();
  });

  it("allows a guardian to read only a verified, unexpired child's document", async () => {
    const guardian: AuthenticatedUser = {
      id: "guardian-user",
      sub: "guardian-sub",
      role: "guardian",
    };
    mocks.queryResults = [
      [{ patientId: "child-a" }],
      [{ id: "child-a", userId: "child-user-a" }],
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
      [{ id: "child-b", userId: "child-user-b" }],
      [],
    ];
    const context = createContext(reflector, guardian, { id: "child-b-document" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("never passes a client-controlled patient or document ID as owner_id", async () => {
    mocks.queryResults = [
      [{ patientId: "client-patient-id" }],
      [{ id: "client-patient-id", userId: "database-owner-id" }],
    ];
    const context = createContext(reflector, patientA, { id: "client-document-id" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    const request = mocks.checkResource.mock.calls[0]?.[0] as {
      resource: { attributes: { owner_id: string } };
    };
    expect(request.resource.attributes.owner_id).toBe("database-owner-id");
    expect(request.resource.attributes.owner_id).not.toBe("client-document-id");
  });

  it("resolves an upload target header to the database owner before Cerbos", async () => {
    mocks.queryResults = [[{ id: "patient-a", userId: "user-a" }]];
    const context = createContext(
      reflector,
      patientA,
      {},
      "document",
      "create",
      { "x-mediqr-patient-id": "patient-a" }
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: "patient-a",
          attributes: { owner_id: "user-a", patient_id: "patient-a" },
        }),
      })
    );
  });

  it("denies guardian upload checks unless Cerbos receives the verified ward owner", async () => {
    const guardian: AuthenticatedUser = {
      id: "guardian-user",
      sub: "guardian-sub",
      role: "guardian",
    };
    mocks.queryResults = [
      [{ id: "child-a", userId: "child-user-a" }],
      [{ ownerUserId: "child-user-a" }],
    ];
    const context = createContext(
      reflector,
      guardian,
      {},
      "document",
      "create",
      { "x-mediqr-patient-id": "child-a" }
    );

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

  it("passes an active patient-facility relationship to Cerbos for facility uploads", async () => {
    const facilityUser: AuthenticatedUser = {
      id: "facility-user",
      sub: "facility-sub",
      role: "facility-admin",
      facilityId: "facility-id",
    };
    mocks.queryResults = [
      [{ id: "patient-a", userId: "patient-user-a" }],
      [{ id: "relationship-id" }],
    ];
    const context = createContext(
      reflector,
      facilityUser,
      {},
      "document",
      "create",
      { "x-mediqr-patient-id": "patient-a" }
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          attributes: expect.objectContaining({ has_patient_relationship: true }),
        }),
        resource: expect.objectContaining({
          attributes: { owner_id: "patient-user-a", patient_id: "patient-a" },
        }),
      })
    );
  });

  it("allows an unverified clinician to read only their own authentication status", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: false,
    };
    mocks.checkResource.mockResolvedValue({ isAllowed: () => true });
    const context = createContext(
      reflector,
      clinician,
      {},
      "auth",
      "read"
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ id: "clinician-user" }),
        resource: expect.objectContaining({ kind: "auth" }),
        actions: ["read"],
      })
    );
  });

  it("continues to deny clinicians patient data until Phase 3 consent", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    const context = createContext(
      reflector,
      clinician,
      { patientId: "patient-id" },
      "patient",
      "read"
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(mocks.checkResource).not.toHaveBeenCalled();
  });

  it("allows a verified clinician to create an access request through Cerbos", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    mocks.checkResource.mockResolvedValue({ isAllowed: () => true });
    const context = createContext(
      reflector,
      clinician,
      {},
      "access-request",
      "create"
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          id: "clinician-user",
          attributes: expect.objectContaining({ is_verified: true }),
        }),
        resource: expect.objectContaining({ kind: "access-request" }),
        actions: ["create"],
      })
    );
  });

  it("denies an unverified clinician access-request creation before Cerbos", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: false,
    };
    const context = createContext(
      reflector,
      clinician,
      {},
      "access-request",
      "create"
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(mocks.checkResource).not.toHaveBeenCalled();
  });

  it("fails closed when Cerbos is unreachable", async () => {
    mocks.checkResource.mockRejectedValue(new Error("PDP unavailable"));
    mocks.queryResults = [
      [{ patientId: "patient-a" }],
      [{ id: "patient-a", userId: "user-a" }],
    ];
    const context = createContext(reflector, patientA, { id: "document-a" });

    await expect(guard.canActivate(context)).rejects.toThrow(
      /policy engine unavailable/i
    );
  });

  it("allows a verified clinician document read only with a matching active database consent scope", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    mocks.queryResults = [
      [{ patientId: "patient-a", documentType: "lab" }],
      [{ id: "patient-a", userId: "patient-owner" }],
      [{ id: "consent-a" }],
    ];
    mocks.checkResource.mockResolvedValue({ isAllowed: () => true });
    const context = createContext(reflector, clinician, { id: "document-a" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mocks.checkResource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          attributes: expect.objectContaining({
            has_consent_grant: true,
            has_scope: true,
          }),
        }),
        resource: expect.objectContaining({
          attributes: expect.objectContaining({ document_type: "lab" }),
        }),
      })
    );
  });

  it("denies a verified clinician without an active database consent scope before Cerbos", async () => {
    const clinician: AuthenticatedUser = {
      id: "clinician-user",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: true,
    };
    mocks.queryResults = [
      [{ patientId: "patient-a", documentType: "lab" }],
      [{ id: "patient-a", userId: "patient-owner" }],
      [],
    ];
    const context = createContext(reflector, clinician, { id: "document-a" });

    await expect(guard.canActivate(context)).rejects.toThrow(
      /no active consent covers this record/i
    );
    expect(mocks.checkResource).not.toHaveBeenCalled();
  });
});
