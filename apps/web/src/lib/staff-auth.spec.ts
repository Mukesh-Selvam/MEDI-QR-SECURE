import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  clearOidcTemporaryCookies,
  setOidcTemporaryCookies,
  setStaffSessionCookies,
  verifySameOriginCsrf,
} from "./staff-auth";
import {
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  STAFF_ACCESS_COOKIE,
  STAFF_CSRF_COOKIE,
  STAFF_REFRESH_COOKIE,
} from "./staff-oidc";

describe("staff browser authentication", () => {
  it("stores OIDC state, nonce, and PKCE verifier in strict HttpOnly secure cookies", () => {
    const response = NextResponse.redirect("https://mediqr.invalid/api/auth/callback");
    setOidcTemporaryCookies(response, {
      state: "random-state",
      nonce: "random-nonce",
      verifier: "pkce-verifier",
    });

    for (const name of [OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE]) {
      const cookie = response.cookies.get(name);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.secure).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.path).toBe("/");
      expect(cookie?.maxAge).toBe(600);
    }
  });

  it("stores access and rotated refresh tokens only in HttpOnly strict secure cookies", () => {
    const response = NextResponse.json({ ok: true });
    setStaffSessionCookies(response, {
      accessToken: "signed-access-token",
      refreshToken: "rotating-refresh-token",
      csrfToken: "csrf-value",
      accessLifetimeSeconds: 300,
      refreshLifetimeSeconds: 3600,
    });

    for (const name of [STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE]) {
      const cookie = response.cookies.get(name);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.secure).toBe(true);
      expect(cookie?.sameSite).toBe("strict");
      expect(cookie?.path).toBe("/");
    }
    expect(response.cookies.get(STAFF_CSRF_COOKIE)?.httpOnly).toBe(false);
    expect(response.cookies.get(STAFF_ACCESS_COOKIE)?.maxAge).toBe(300);
  });

  it("clears OIDC one-time cookies after callback", () => {
    const response = NextResponse.json({ ok: true });
    clearOidcTemporaryCookies(response);
    for (const name of [OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE]) {
      expect(response.cookies.get(name)?.maxAge).toBe(0);
    }
  });

  it("requires same-origin and matching double-submit CSRF tokens", () => {
    const validRequest = new NextRequest("https://mediqr.invalid/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://mediqr.invalid",
        cookie: `${STAFF_CSRF_COOKIE}=random-token`,
        "x-csrf-token": "random-token",
      },
    });
    expect(verifySameOriginCsrf(validRequest, STAFF_CSRF_COOKIE)).toBe(true);

    const crossOriginRequest = new NextRequest("https://mediqr.invalid/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.invalid",
        cookie: `${STAFF_CSRF_COOKIE}=random-token`,
        "x-csrf-token": "random-token",
      },
    });
    expect(verifySameOriginCsrf(crossOriginRequest, STAFF_CSRF_COOKIE)).toBe(false);

    const mismatchedRequest = new NextRequest("https://mediqr.invalid/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://mediqr.invalid",
        cookie: `${STAFF_CSRF_COOKIE}=random-token`,
        "x-csrf-token": "different-token",
      },
    });
    expect(verifySameOriginCsrf(mismatchedRequest, STAFF_CSRF_COOKIE)).toBe(false);
  });
});
