import { createHash, randomBytes } from "node:crypto";
import { SignJWT } from "jose";

export function createQrCredentialToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashQrCredentialToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signInAppQrToken(
  credentialId: string,
  signingKey: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const currentSeconds = Math.floor(now.getTime() / 1000);
  const issuedAt = Math.floor(currentSeconds / 60) * 60;
  const expiresAtSeconds = issuedAt + 60;
  const key = Buffer.from(signingKey);
  const token = await new SignJWT({ purpose: "in-app-qr" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("mediqr-api")
    .setAudience("mediqr-qr-resolution")
    .setSubject(credentialId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .setJti(
      createHash("sha256")
        .update(`${credentialId}:${issuedAt}`)
        .digest("hex")
    )
    .sign(key);

  return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
}
