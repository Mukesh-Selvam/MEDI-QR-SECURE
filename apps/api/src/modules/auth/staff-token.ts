import {
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

const CLOCK_TOLERANCE_SECONDS = 5;
const ACCEPTED_MFA_METHODS = new Set(["otp", "webauthn"]);

export async function verifyStaffAccessToken(
  token: string,
  getKey: JWTVerifyGetKey,
  issuer: string,
  clientId: string
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["RS256"],
    issuer,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });

  if (typeof payload.exp !== "number") {
    throw new Error("Staff access token is missing expiration");
  }

  const audienceMatches =
    payload.aud === clientId ||
    (Array.isArray(payload.aud) && payload.aud.includes(clientId));
  const authorizedPartyMatches = payload.azp === clientId;
  if (!audienceMatches && !authorizedPartyMatches) {
    throw new Error("Staff access token audience is invalid");
  }

  const authenticationMethods = payload.amr;
  if (
    !Array.isArray(authenticationMethods) ||
    !authenticationMethods.some(
      (method) =>
        typeof method === "string" && ACCEPTED_MFA_METHODS.has(method)
    )
  ) {
    throw new Error("Staff access token does not prove an accepted MFA method");
  }

  return payload;
}
