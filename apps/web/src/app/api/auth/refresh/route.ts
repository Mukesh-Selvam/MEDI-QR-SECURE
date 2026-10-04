import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { jwtVerify } from "jose";
import {
  apiJsonError,
  clearStaffSessionCookies,
  setStaffSessionCookies,
  verifySameOriginCsrf,
} from "@/lib/staff-auth";
import {
  getOidcConfig,
  isValidTokenResponse,
  STAFF_CSRF_COOKIE,
  STAFF_REFRESH_COOKIE,
  verifyStaffAccessToken,
} from "@/lib/staff-oidc";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifySameOriginCsrf(request, STAFF_CSRF_COOKIE)) {
    return apiJsonError(403, "CSRF validation failed.");
  }

  const refreshToken = request.cookies.get(STAFF_REFRESH_COOKIE)?.value;
  if (!refreshToken) return apiJsonError(401, "Staff session has expired.");

  const config = getOidcConfig();
  try {
    const tokenResponse = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return expiredSession();
    const tokenBody: unknown = await tokenResponse.json();
    if (
      !isValidTokenResponse(tokenBody) ||
      tokenBody.expires_in <= 0 ||
      tokenBody.refresh_expires_in <= 0
    ) {
      return expiredSession();
    }
    await verifyStaffAccessToken(tokenBody.access_token, config);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const { payload } = await jwtVerify(tokenBody.access_token, config.jwks, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      clockTolerance: 5,
    });
    const lifetime = Math.max(
      1,
      Math.min(tokenBody.expires_in, (payload.exp ?? nowSeconds) - nowSeconds)
    );
    const response = NextResponse.json({ expiresIn: lifetime });
    setStaffSessionCookies(response, {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      csrfToken: randomBytes(32).toString("base64url"),
      accessLifetimeSeconds: lifetime,
      refreshLifetimeSeconds: tokenBody.refresh_expires_in,
    });
    return response;
  } catch {
    return expiredSession();
  }
}

function expiredSession(): NextResponse {
  const response = apiJsonError(401, "Staff session has expired.");
  clearStaffSessionCookies(response);
  return response;
}
