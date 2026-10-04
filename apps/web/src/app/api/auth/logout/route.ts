import { NextRequest, NextResponse } from "next/server";
import {
  apiJsonError,
  clearStaffSessionCookies,
  verifySameOriginCsrf,
} from "@/lib/staff-auth";
import {
  getOidcConfig,
  STAFF_CSRF_COOKIE,
  STAFF_REFRESH_COOKIE,
} from "@/lib/staff-oidc";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifySameOriginCsrf(request, STAFF_CSRF_COOKIE)) {
    return apiJsonError(403, "CSRF validation failed.");
  }

  const response = NextResponse.json({ message: "Signed out." });
  const refreshToken = request.cookies.get(STAFF_REFRESH_COOKIE)?.value;
  const config = getOidcConfig();
  if (refreshToken) {
    try {
      const keycloakResponse = await fetch(config.logoutEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          refresh_token: refreshToken,
        }),
        cache: "no-store",
      });
      if (!keycloakResponse.ok) {
        clearStaffSessionCookies(response);
        return apiJsonError(502, "Could not end the identity-provider session.");
      }
    } catch {
      clearStaffSessionCookies(response);
      return apiJsonError(502, "Could not end the identity-provider session.");
    }
  }
  clearStaffSessionCookies(response);
  return response;
}
