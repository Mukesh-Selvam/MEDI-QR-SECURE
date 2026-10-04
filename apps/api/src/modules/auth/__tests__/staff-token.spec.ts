import { describe, expect, it } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose";
import { verifyStaffAccessToken } from "../staff-token.js";

const ISSUER = "http://localhost:8080/realms/mediqr";
const CLIENT_ID = "mediqr-web";

describe("staff access token validation", () => {
  it("accepts a correctly signed RS256 token for the expected issuer and client", async () => {
    const { token, getKey } = await createSignedToken({
      issuer: ISSUER,
      azp: CLIENT_ID,
      audience: "account",
      expiration: "5m",
    });

    await expect(
      verifyStaffAccessToken(token, getKey, ISSUER, CLIENT_ID)
    ).resolves.toMatchObject({ sub: "keycloak-user", azp: CLIENT_ID });
  });

  it("rejects a forged signature", async () => {
    const { token, getKey } = await createSignedToken({
      issuer: ISSUER,
      azp: CLIENT_ID,
      expiration: "5m",
    });
    const parts = token.split(".");
    const payloadSegment = parts[1] ?? "";
    parts[1] = `${payloadSegment.startsWith("A") ? "B" : "A"}${payloadSegment.slice(1)}`;

    await expect(
      verifyStaffAccessToken(parts.join("."), getKey, ISSUER, CLIENT_ID)
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { token, getKey } = await createSignedToken({
      issuer: ISSUER,
      azp: CLIENT_ID,
      expiration: "-1m",
    });

    await expect(
      verifyStaffAccessToken(token, getKey, ISSUER, CLIENT_ID)
    ).rejects.toThrow();
  });

  it("rejects a token with the wrong issuer", async () => {
    const { token, getKey } = await createSignedToken({
      issuer: "http://untrusted.example/realms/mediqr",
      azp: CLIENT_ID,
      expiration: "5m",
    });

    await expect(
      verifyStaffAccessToken(token, getKey, ISSUER, CLIENT_ID)
    ).rejects.toThrow();
  });

  it("rejects a token with the wrong audience and authorized party", async () => {
    const { token, getKey } = await createSignedToken({
      issuer: ISSUER,
      audience: "wrong-client",
      azp: "wrong-client",
      expiration: "5m",
    });

    await expect(
      verifyStaffAccessToken(token, getKey, ISSUER, CLIENT_ID)
    ).rejects.toThrow(/audience/i);
  });
});

async function createSignedToken(options: {
  issuer: string;
  azp?: string;
  audience?: string;
  expiration: string;
}): Promise<{
  token: string;
  getKey: ReturnType<typeof createLocalJWKSet>;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const getKey = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
  });

  let builder = new SignJWT(options.azp ? { azp: options.azp } : {})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer)
    .setSubject("keycloak-user")
    .setIssuedAt()
    .setExpirationTime(options.expiration);
  if (options.audience) builder = builder.setAudience(options.audience);

  return { token: await builder.sign(privateKey), getKey };
}
