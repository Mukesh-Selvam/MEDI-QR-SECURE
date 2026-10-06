import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clearOidcTemporaryCookies,
  setStaffSessionCookies,
} from "@/lib/staff-auth";
import {
  isValidTokenResponse,
  getOidcConfig,
  StaffMfaRequiredError,
  verifyIdToken,
  verifyStaffAccessToken,
} from "@/lib/staff-oidc";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getOidcConfig();
  const query = request.nextUrl.searchParams;
  const code = query.get("code");
  const returnedState = query.get("state");
  const expectedState = request.cookies.get("__Host-mediqr-oidc-state")?.value;
  const nonce = request.cookies.get("__Host-mediqr-oidc-nonce")?.value;
  const verifier = request.cookies.get("__Host-mediqr-oidc-verifier")?.value;
  const stateMatches =
    returnedState !== null &&
    expectedState !== undefined &&
    safeEqual(returnedState, expectedState);

  if (!code || !stateMatches || !nonce || !verifier || query.has("error")) {
    return failedCallback(config.webOrigin);
  }

  try {
    const tokenResponse = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: config.callbackUrl,
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return failedCallback(config.webOrigin);
    const tokenBody: unknown = await tokenResponse.json();
    if (
      !isValidTokenResponse(tokenBody) ||
      !tokenBody.id_token ||
      tokenBody.expires_in <= 0 ||
      tokenBody.refresh_expires_in <= 0
    ) {
      return failedCallback(config.webOrigin);
    }

    const identity = await verifyIdToken(tokenBody.id_token, nonce, config);
    const staffToken = await verifyStaffAccessToken(
      tokenBody.access_token,
      config
    );
    if (identity.sub !== staffToken.sub) return failedCallback(config.webOrigin);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const accessLifetime = Math.max(
      1,
      Math.min(tokenBody.expires_in, (staffToken.exp ?? nowSeconds) - nowSeconds)
    );
    const refreshLifetime = Math.min(tokenBody.refresh_expires_in, 3600);
    const response = NextResponse.redirect(
      new URL("/login/clinician?auth=success", config.webOrigin)
    );
    clearOidcTemporaryCookies(response);
    setStaffSessionCookies(response, {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      csrfToken: randomBytes(32).toString("base64url"),
      accessLifetimeSeconds: accessLifetime,
      refreshLifetimeSeconds: refreshLifetime,
    });
    return response;
  } catch (error) {
    if (error instanceof StaffMfaRequiredError) {
      console.info("Staff OIDC login requires MFA setup.");
      return failedCallback(config.webOrigin, "mfa-setup");
    }
    console.error("Staff OIDC callback validation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return failedCallback(config.webOrigin);
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function failedCallback(
  origin: string,
  authResult: "failed" | "mfa-setup" = "failed"
): NextResponse {
  const response = NextResponse.redirect(
    new URL(`/login/clinician?auth=${authResult}`, origin)
  );
  clearOidcTemporaryCookies(response);
  return response;
}
