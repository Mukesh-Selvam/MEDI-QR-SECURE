import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  STAFF_ACCESS_COOKIE,
  STAFF_CSRF_COOKIE,
  STAFF_REFRESH_COOKIE,
  STAFF_REFRESH_LIFETIME_SECONDS,
} from "./staff-oidc";

const COOKIE_FLAGS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

const OIDC_TEMP_COOKIE_FLAGS = {
  ...COOKIE_FLAGS,
  sameSite: "lax" as const,
  maxAge: 600,
};

export function setOidcTemporaryCookies(
  response: NextResponse,
  values: { state: string; nonce: string; verifier: string }
): void {
  response.cookies.set(OIDC_STATE_COOKIE, values.state, OIDC_TEMP_COOKIE_FLAGS);
  response.cookies.set(OIDC_NONCE_COOKIE, values.nonce, OIDC_TEMP_COOKIE_FLAGS);
  response.cookies.set(
    OIDC_VERIFIER_COOKIE,
    values.verifier,
    OIDC_TEMP_COOKIE_FLAGS
  );
}

export function clearOidcTemporaryCookies(response: NextResponse): void {
  for (const name of [
    OIDC_STATE_COOKIE,
    OIDC_NONCE_COOKIE,
    OIDC_VERIFIER_COOKIE,
  ]) {
    response.cookies.set(name, "", { ...COOKIE_FLAGS, maxAge: 0 });
  }
}

export function setStaffSessionCookies(
  response: NextResponse,
  session: {
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
    accessLifetimeSeconds: number;
    refreshLifetimeSeconds: number;
  }
): void {
  response.cookies.set(STAFF_ACCESS_COOKIE, session.accessToken, {
    ...COOKIE_FLAGS,
    maxAge: session.accessLifetimeSeconds,
  });
  response.cookies.set(STAFF_REFRESH_COOKIE, session.refreshToken, {
    ...COOKIE_FLAGS,
    maxAge: Math.min(
      session.refreshLifetimeSeconds,
      STAFF_REFRESH_LIFETIME_SECONDS
    ),
  });
  response.cookies.set(STAFF_CSRF_COOKIE, session.csrfToken, {
    ...COOKIE_FLAGS,
    httpOnly: false,
    maxAge: Math.min(
      session.refreshLifetimeSeconds,
      STAFF_REFRESH_LIFETIME_SECONDS
    ),
  });
}

export function clearStaffSessionCookies(response: NextResponse): void {
  for (const name of [
    STAFF_ACCESS_COOKIE,
    STAFF_REFRESH_COOKIE,
    STAFF_CSRF_COOKIE,
    OIDC_STATE_COOKIE,
    OIDC_NONCE_COOKIE,
    OIDC_VERIFIER_COOKIE,
  ]) {
    response.cookies.set(name, "", { ...COOKIE_FLAGS, maxAge: 0 });
  }
}

export function verifySameOriginCsrf(
  request: NextRequest,
  csrfCookieName: string
): boolean {
  const origin = request.headers.get("origin");
  const cookieValue = request.cookies.get(csrfCookieName)?.value;
  const headerValue = request.headers.get("x-csrf-token");
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    !cookieValue ||
    !headerValue
  ) {
    return false;
  }

  const cookie = Buffer.from(cookieValue);
  const header = Buffer.from(headerValue);
  return cookie.length === header.length && timingSafeEqual(cookie, header);
}

export function apiOrigin(): string {
  const origin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
  return new URL(origin).origin;
}

export function apiJsonError(
  status: number,
  error: string
): NextResponse<{ error: string }> {
  return NextResponse.json({ error }, { status });
}
