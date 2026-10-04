import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { errors, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { qrCredentials } from "../../database/schema.js";
import { env } from "../../config/env.js";

export const QR_REDIS_CLIENT = Symbol("QR_REDIS_CLIENT");

const RATE_WINDOW_SECONDS = 60;
const IP_REQUEST_LIMIT = 30;
const TOKEN_REQUEST_LIMIT = 10;
const RESOLUTION_TTL_SECONDS = 120;

@Injectable()
export class QrResolutionService implements OnModuleDestroy {
  constructor(@Inject(QR_REDIS_CLIENT) private readonly redis: Redis) {}

  async resolve(
    token: string,
    resolutionId: string,
    clientIp: string
  ): Promise<void> {
    const tokenHash = sha256(token);
    const ipHash = sha256(clientIp);
    const ipAllowed = await this.consumeRateLimit(
      `qr:rate:ip:${ipHash}`,
      IP_REQUEST_LIMIT
    );
    if (!ipAllowed) {
      throw new HttpException(
        "QR resolution is temporarily unavailable",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const tokenAllowed = await this.consumeRateLimit(
      `qr:rate:token:${tokenHash}`,
      TOKEN_REQUEST_LIMIT
    );
    if (!tokenAllowed) {
      throw new HttpException(
        "QR resolution is temporarily unavailable",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const credentialId = await this.findActiveCredentialId(token);
    if (!credentialId) return;

    const stored = await this.redis.set(
      `qr:resolution:${resolutionId}`,
      credentialId,
      "EX",
      RESOLUTION_TTL_SECONDS,
      "NX"
    );
    if (stored !== "OK") return;
  }

  async consumeRequestResolution(resolutionId: string): Promise<string | null> {
    return this.redis.getdel(`qr:resolution:${resolutionId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private async findActiveCredentialId(token: string): Promise<string | undefined> {
    if (token.includes(".")) {
      const payload = await this.verifyInAppToken(token);
      if (
        !payload ||
        typeof payload.sub !== "string" ||
        typeof payload.jti !== "string" ||
        payload.purpose !== "in-app-qr"
      ) {
        return undefined;
      }

      const [credential] = await db
        .select({ id: qrCredentials.id })
        .from(qrCredentials)
        .where(
          and(
            eq(qrCredentials.id, payload.sub),
            eq(qrCredentials.status, "active")
          )
        )
        .limit(1);
      if (!credential) return undefined;

      const replayMarker = await this.redis.set(
        `qr:replay:${sha256(payload.jti)}`,
        "1",
        "EX",
        RESOLUTION_TTL_SECONDS,
        "NX"
      );
      return replayMarker === "OK" ? credential.id : undefined;
    }

    if (!is128BitToken(token)) return undefined;

    const [credential] = await db
      .select({ id: qrCredentials.id })
      .from(qrCredentials)
      .where(
        and(
          eq(qrCredentials.tokenHash, sha256(token)),
          eq(qrCredentials.status, "active")
        )
      )
      .limit(1);
    return credential?.id;
  }

  private async verifyInAppToken(token: string) {
    try {
      const { payload } = await jwtVerify(
        token,
        Buffer.from(env.HMAC_QR_SIGNING_KEY),
        {
          algorithms: ["HS256"],
          issuer: "mediqr-api",
          audience: "mediqr-qr-resolution",
          clockTolerance: 0,
        }
      );
      return payload;
    } catch (error) {
      if (error instanceof errors.JOSEError) return undefined;
      throw error;
    }
  }

  private async consumeRateLimit(key: string, limit: number): Promise<boolean> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, RATE_WINDOW_SECONDS);
    return count <= limit;
  }
}

function is128BitToken(token: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return false;
  return Buffer.from(token, "base64url").length === 16;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
