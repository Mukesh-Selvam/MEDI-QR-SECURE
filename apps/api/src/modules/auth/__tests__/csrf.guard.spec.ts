import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { CsrfGuard } from "../guards/csrf.guard.js";

function makeGuardContext(options: {
  method: string;
  url: string;
  isPublic: boolean;
  origin?: string;
  csrfCookie?: string;
  csrfHeader?: string;
}): { guard: CsrfGuard; context: ExecutionContext } {
  const request = {
    method: options.method,
    url: options.url,
    headers: {
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.csrfHeader ? { "x-csrf-token": options.csrfHeader } : {}),
    },
    cookies: options.csrfCookie
      ? { "__Host-mediqr-csrf": options.csrfCookie }
      : {},
  };
  const reflector = {
    getAllAndOverride: vi.fn(() => options.isPublic),
  } as unknown as Reflector;
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard: new CsrfGuard(reflector), context };
}

describe("CsrfGuard", () => {
  it("checks CSRF tokens for public refresh requests", () => {
    const { guard, context } = makeGuardContext({
      method: "POST",
      url: "/api/v1/auth/refresh",
      isPublic: true,
      origin: "http://localhost:3000",
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejects a cross-origin public authentication mutation", () => {
    const { guard, context } = makeGuardContext({
      method: "POST",
      url: "/api/v1/auth/otp/send",
      isPublic: true,
      origin: "https://attacker.invalid",
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("allows same-origin public OTP requests without an authenticated CSRF cookie", () => {
    const { guard, context } = makeGuardContext({
      method: "POST",
      url: "/api/v1/auth/otp/send",
      isPublic: true,
      origin: "http://localhost:3000",
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
