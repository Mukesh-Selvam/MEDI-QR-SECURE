import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  activeSession: [] as Array<{ id: string }>,
  user: null as
    | {
        id: string;
        role: string;
        status: string;
        facilityId: string | null;
      }
    | null,
}));

vi.mock("../../../database/index.js", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mockState.activeSession),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (mockState.user ? [mockState.user] : [])),
        })),
      })),
    })),
  },
}));

vi.mock("../../../database/schema.js", () => ({
  clinicians: {},
  sessions: {
    accessTokenIdHash: "accessTokenIdHash",
    userId: "userId",
    revokedAt: "revokedAt",
    expiresAt: "expiresAt",
    id: "id",
  },
  users: { id: "id", keycloakId: "keycloakId" },
}));

import { JwtAuthGuard } from "../guards/jwt-auth.guard.js";

const SESSION_SECRET = "unit-test-session-secret-at-least-32";

describe("JwtAuthGuard patient sessions", () => {
  beforeEach(() => {
    mockState.activeSession = [{ id: "session-row-id" }];
    mockState.user = {
      id: "patient-user-id",
      role: "patient",
      status: "active",
      facilityId: null,
    };
  });

  it("denies the next request when the server-side session has been revoked", async () => {
    mockState.activeSession = [];
    const { guard, context, request } = await makeGuardContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(request.user).toBeUndefined();
  });

  it("uses the database role and active session, not role claims in the JWT", async () => {
    const { guard, context, request } = await makeGuardContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: "patient-user-id",
      role: "patient",
      sessionId: "session-row-id",
    });
  });
});

async function makeGuardContext(): Promise<{
  guard: JwtAuthGuard;
  context: ExecutionContext;
  request: Record<string, unknown>;
}> {
  const token = await new SignJWT({
    mediqr_user_id: "patient-user-id",
    role: "platform-admin",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mediqr-api")
    .setAudience("mediqr-api")
    .setSubject("patient-user-id")
    .setJti("opaque-access-token-id")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(Buffer.from(SESSION_SECRET));
  const request: Record<string, unknown> = {
    cookies: { "__Host-mediqr-access": token },
  };
  const reflector = {
    getAllAndOverride: vi.fn(() => false),
  } as unknown as Reflector;
  const guard = new JwtAuthGuard(reflector);
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard, context, request };
}
