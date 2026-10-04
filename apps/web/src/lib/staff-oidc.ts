import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

export const STAFF_ACCESS_COOKIE = "__Host-mediqr-access";
export const STAFF_REFRESH_COOKIE = "__Host-mediqr-staff-refresh";
export const STAFF_CSRF_COOKIE = "__Host-mediqr-csrf";
export const OIDC_STATE_COOKIE = "__Host-mediqr-oidc-state";
export const OIDC_NONCE_COOKIE = "__Host-mediqr-oidc-nonce";
export const OIDC_VERIFIER_COOKIE = "__Host-mediqr-oidc-verifier";
export const STAFF_REFRESH_LIFETIME_SECONDS = 3600;

const CLOCK_TOLERANCE_SECONDS = 5;
const ACCEPTED_MFA_METHODS = new Set(["otp", "webauthn"]);
const URL_SCHEME = /^https:\/\//i;
const LOCAL_WEB_ORIGIN = "http://localhost:3000";

export class StaffMfaRequiredError extends Error {
  readonly methods: string[];

  constructor(methods: unknown) {
    super("Staff access token does not prove an accepted MFA method.");
    this.name = "StaffMfaRequiredError";
    this.methods = Array.isArray(methods)
      ? methods.filter((method): method is string => typeof method === "string")
      : [];
  }
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  callbackUrl: string;
  webOrigin: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  logoutEndpoint: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

export interface OidcTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  id_token?: string;
}

let cachedJwks:
  | { uri: string; keySet: ReturnType<typeof createRemoteJWKSet> }
  | undefined;

export function getOidcConfig(): OidcConfig {
  const baseUrl = process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8080";
  const realm = process.env.KEYCLOAK_REALM ?? "mediqr";
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "mediqr-web";
  const webOrigin = process.env.WEB_BASE_URL ?? LOCAL_WEB_ORIGIN;
  const base = new URL(baseUrl);
  const web = new URL(webOrigin);

  if (
    (process.env.NODE_ENV === "production" &&
      (!URL_SCHEME.test(baseUrl) || !URL_SCHEME.test(webOrigin))) ||
    (web.protocol !== "https:" && webOrigin !== LOCAL_WEB_ORIGIN)
  ) {
    throw new Error("Staff OIDC requires HTTPS outside local development.");
  }

  const issuer = `${base.href.replace(/\/+$/, "")}/realms/${encodeURIComponent(realm)}`;
  const discoveryBase = `${issuer}/protocol/openid-connect`;
  const jwksUri = `${discoveryBase}/certs`;
  if (!cachedJwks || cachedJwks.uri !== jwksUri) {
    cachedJwks = {
      uri: jwksUri,
      keySet: createRemoteJWKSet(new URL(jwksUri), {
        cacheMaxAge: 10 * 60 * 1000,
        cooldownDuration: 30 * 1000,
      }),
    };
  }

  return {
    issuer,
    clientId,
    callbackUrl: new URL("/api/auth/callback", web).href,
    webOrigin: web.origin,
    authorizationEndpoint: `${discoveryBase}/auth`,
    tokenEndpoint: `${discoveryBase}/token`,
    logoutEndpoint: `${discoveryBase}/logout`,
    jwks: cachedJwks.keySet,
  };
}

export async function verifyStaffAccessToken(
  token: string,
  config: OidcConfig
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, config.jwks, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });

  const audienceMatches =
    payload.aud === config.clientId ||
    (Array.isArray(payload.aud) && payload.aud.includes(config.clientId));
  if (
    typeof payload.exp !== "number" ||
    (!audienceMatches && payload.azp !== config.clientId)
  ) {
    throw new Error("Staff access token audience or expiry is invalid.");
  }

  const methods = payload.amr;
  if (
    !Array.isArray(methods) ||
    !methods.some(
      (method) =>
        typeof method === "string" && ACCEPTED_MFA_METHODS.has(method)
    )
  ) {
    throw new StaffMfaRequiredError(methods);
  }

  return payload;
}

export async function verifyIdToken(
  token: string,
  nonce: string,
  config: OidcConfig
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, config.jwks, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience: config.clientId,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string") {
    throw new Error("Staff identity token nonce or subject is invalid.");
  }
  return payload;
}

export function isValidTokenResponse(
  value: unknown
): value is OidcTokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data["access_token"] === "string" &&
    typeof data["refresh_token"] === "string" &&
    typeof data["expires_in"] === "number" &&
    Number.isFinite(data["expires_in"]) &&
    typeof data["refresh_expires_in"] === "number" &&
    Number.isFinite(data["refresh_expires_in"]) &&
    typeof data["token_type"] === "string" &&
    data["token_type"].toLowerCase() === "bearer"
  );
}
