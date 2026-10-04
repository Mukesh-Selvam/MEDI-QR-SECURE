import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { setOidcTemporaryCookies } from "@/lib/staff-auth";
import { getOidcConfig } from "@/lib/staff-oidc";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = getOidcConfig();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizationUrl = new URL(config.authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile email",
    redirect_uri: config.callbackUrl,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  setOidcTemporaryCookies(response, { state, nonce, verifier });
  return response;
}
