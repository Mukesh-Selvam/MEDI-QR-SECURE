import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  createQrCredentialToken,
  hashQrCredentialToken,
  signInAppQrToken,
} from "./qr-token.js";

describe("QR credential tokens", () => {
  it("creates a 128-bit opaque credential and stores only its SHA-256 digest", () => {
    const token = createQrCredentialToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(16);
    expect(hashQrCredentialToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashQrCredentialToken(token)).not.toBe(token);
  });

  it("signs an opaque in-app QR token that changes on each 60-second window", async () => {
    const signingKey = "unit-test-qr-signing-key-at-least-32";
    const start = new Date("2026-10-04T10:00:00.000Z");
    const first = await signInAppQrToken("opaque-credential-id", signingKey, start);
    const sameWindow = await signInAppQrToken(
      "opaque-credential-id",
      signingKey,
      new Date(start.getTime() + 59_000)
    );
    const nextWindow = await signInAppQrToken(
      "opaque-credential-id",
      signingKey,
      new Date(start.getTime() + 60_000)
    );

    expect(first.token).toBe(sameWindow.token);
    expect(nextWindow.token).not.toBe(first.token);
    expect(first.expiresAt.getTime() - start.getTime()).toBe(60_000);

    const { payload } = await jwtVerify(first.token, Buffer.from(signingKey), {
      algorithms: ["HS256"],
      issuer: "mediqr-api",
      audience: "mediqr-qr-resolution",
      currentDate: new Date(start.getTime() + 1_000),
    });
    expect(payload.sub).toBe("opaque-credential-id");
    expect(payload.purpose).toBe("in-app-qr");
    expect(payload).not.toHaveProperty("patientId");
    expect(payload).not.toHaveProperty("healthId");
    expect(payload.exp! - payload.iat!).toBe(60);

    await expect(
      jwtVerify(first.token, Buffer.from(signingKey), {
        algorithms: ["HS256"],
        issuer: "mediqr-api",
        audience: "mediqr-qr-resolution",
        currentDate: first.expiresAt,
      })
    ).rejects.toThrow();
  });
});
