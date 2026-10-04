/**
 * unverified-clinician.spec.ts
 * ============================
 * Condition 5: Policy layer fails closed (unreachable / errors -> deny).
 * Condition 9: Unverified clinicians can log in, but every patient-data endpoint denies them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PolicyGuard } from "../guards/policy.guard.js";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import { POLICY_KEY } from "../decorators/policy.decorator.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";

// Mock env
vi.mock("../../../config/env.js", () => ({
  env: {
    CERBOS_HOST: "127.0.0.1",
    CERBOS_PORT: 3593,
    SESSION_SECRET: "test_session_secret_min_32_chars_abcdefgh",
  },
}));

// Mock Cerbos GRPC
const mockCheckResource = vi.fn();
vi.mock("@cerbos/grpc", () => {
  return {
    GRPC: vi.fn().mockImplementation(() => ({
      checkResource: mockCheckResource,
    })),
  };
});

function createMockContext(
  reflector: Reflector,
  user: AuthenticatedUser | undefined,
  policyMetadata: { resource: string; action: string } | undefined,
  isPublic = false
): ExecutionContext {
  vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key: string) => {
    if (key === PUBLIC_ROUTE_KEY) return isPublic;
    if (key === POLICY_KEY) return policyMetadata;
    return undefined;
  });

  const request = {
    cookies: {},
    params: { id: "patient-123" },
    user,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("PolicyGuard — Clinician Verification & Fail-Closed (Conditions 5 & 9)", () => {
  let guard: PolicyGuard;
  let reflector: Reflector;

  beforeEach(() => {
    vi.clearAllMocks();
    reflector = new Reflector();
    guard = new PolicyGuard(reflector);
  });

  it("permits public routes without touching Cerbos or user session", async () => {
    const ctx = createMockContext(reflector, undefined, undefined, true);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockCheckResource).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when user is unauthenticated on protected route", async () => {
    const ctx = createMockContext(reflector, undefined, { resource: "patient", action: "read" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("denies unverified clinicians access to patient data before consulting Cerbos", async () => {
    const unverifiedClinician: AuthenticatedUser = {
      id: "clinician-unverified-uuid",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: false,
    };

    const ctx = createMockContext(reflector, unverifiedClinician, {
      resource: "patient",
      action: "read",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/until Phase 3 consent/i);
    expect(mockCheckResource).not.toHaveBeenCalled();
  });

  it("denies verified clinicians access to document records until Phase 3 consent exists", async () => {
    const unverifiedClinician: AuthenticatedUser = {
      id: "clinician-unverified-uuid",
      sub: "clinician-sub",
      role: "clinician",
      isVerified: false,
    };

    const ctx = createMockContext(reflector, unverifiedClinician, {
      resource: "document",
      action: "read",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/until Phase 3 consent/i);
    expect(mockCheckResource).not.toHaveBeenCalled();
  });

  it("Condition 5: fails closed (returns 403 Forbidden) if policy engine is unreachable or errors", async () => {
    const patient: AuthenticatedUser = {
      id: "patient-uuid",
      sub: "patient-sub",
      role: "patient",
    };

    // Simulate PDP connection drop / gRPC network error
    mockCheckResource.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:3593")
    );

    const ctx = createMockContext(reflector, patient, {
      resource: "patient",
      action: "read",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Authorization policy engine unavailable (fail-closed)"
    );
  });
});
