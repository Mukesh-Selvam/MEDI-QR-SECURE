import {
  Inject,
  Injectable,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { errors, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { qrCredentials } from "../../database/schema.js";
import { env } from "../../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuditAction } from "../audit/audit.types.js";

export const QR_REDIS_CLIENT = Symbol("QR_REDIS_CLIENT");

type ResolutionOutcome =
  | "success"
  | "unknown"
  | "expired"
  | "revoked"
  | "rate-limited"
  | "replayed"
  | "failure";

interface CredentialResolution {
  credentialId?: string;
  outcome: ResolutionOutcome;
  replayMarkerKey?: string;
}

const RATE_WINDOW_SECONDS = 60;
const IP_REQUEST_LIMIT = 30;
const TOKEN_REQUEST_LIMIT = 10;
const RESOLUTION_TTL_SECONDS = 120;
const RESOLUTION_AUDIT_ACTIONS: Record<ResolutionOutcome, AuditAction> = {
  success: "QR_RESOLUTION_SUCCESS",
  unknown: "QR_RESOLUTION_UNKNOWN",
  expired: "QR_RESOLUTION_EXPIRED",
  revoked: "QR_RESOLUTION_REVOKED",
  "rate-limited": "QR_RESOLUTION_RATE_LIMITED",
  replayed: "QR_RESOLUTION_REPLAYED",
  failure: "QR_RESOLUTION_FAILURE",
};

@Injectable()
export class QrResolutionService implements OnModuleDestroy {
  constructor(
    @Inject(QR_REDIS_CLIENT) private readonly redis: Redis,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async resolve(
    token: string,
    resolutionId: string,
    clientIp: string
  ): Promise<void> {
    const tokenHash = sha256(token);
    const ipHash = sha256(clientIp);
    let outcome: ResolutionOutcome = "failure";
    let failure: { error: unknown } | undefined;
    let resolutionKeyCreated = false;
    let replayMarkerKey: string | undefined;

    try {
      const ipAllowed = await this.consumeRateLimit(
        `qr:rate:ip:${ipHash}`,
        IP_REQUEST_LIMIT
      );
      if (!ipAllowed) {
        outcome = "rate-limited";
      } else {
        const tokenAllowed = await this.consumeRateLimit(
          `qr:rate:token:${tokenHash}`,
          TOKEN_REQUEST_LIMIT
        );
        if (!tokenAllowed) {
          outcome = "rate-limited";
        } else {
          const resolution = await this.findCredential(token);
          outcome = resolution.outcome;
          replayMarkerKey = resolution.replayMarkerKey;

          if (resolution.credentialId) {
            const stored = await this.redis.set(
              `qr:resolution:${resolutionId}`,
              resolution.credentialId,
              "EX",
              RESOLUTION_TTL_SECONDS,
              "NX"
            );
            if (stored === "OK") {
              outcome = "success";
              resolutionKeyCreated = true;
            } else {
              outcome = "replayed";
              if (replayMarkerKey) {
                await this.redis.del(replayMarkerKey);
                replayMarkerKey = undefined;
              }
            }
          }
        }
      }
    } catch (error) {
      failure = { error };
      outcome = "failure";
    }

    try {
      await this.audit.log({
        action: RESOLUTION_AUDIT_ACTIONS[outcome],
        resourceType: "qr_resolution",
        resourceId: resolutionId,
        outcome:
          outcome === "success"
            ? "SUCCESS"
            : outcome === "failure"
              ? "FAILURE"
              : "DENIED",
        ipHash: this.audit.hashIp(clientIp),
      });
    } catch (error) {
      if (resolutionKeyCreated || replayMarkerKey) {
        const keys = [
          ...(resolutionKeyCreated ? [`qr:resolution:${resolutionId}`] : []),
          ...(replayMarkerKey ? [replayMarkerKey] : []),
        ];
        try {
          await this.redis.del(...keys);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "QR resolution audit failed and temporary state cleanup failed."
          );
        }
      }
      throw error;
    }

    if (failure && replayMarkerKey) {
      try {
        await this.redis.del(replayMarkerKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [failure.error, cleanupError],
          "QR resolution failed and temporary replay state cleanup failed."
        );
      }
    }
    if (failure) throw failure.error;
  }

  async consumeRequestResolution(resolutionId: string): Promise<string | null> {
    return this.redis.getdel(`qr:resolution:${resolutionId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private async findCredential(token: string): Promise<CredentialResolution> {
    if (token.includes(".")) {
      const payload = await this.verifyInAppToken(token);
      if (payload.expired) return { outcome: "expired" };
      if (
        !payload.payload ||
        typeof payload.payload.sub !== "string" ||
        !isUuid(payload.payload.sub) ||
        typeof payload.payload.jti !== "string" ||
        payload.payload.purpose !== "in-app-qr"
      ) {
        return { outcome: "unknown" };
      }

      const [credential] = await db
        .select({ id: qrCredentials.id, status: qrCredentials.status })
        .from(qrCredentials)
        .where(eq(qrCredentials.id, payload.payload.sub))
        .limit(1);
      if (!credential) return { outcome: "unknown" };
      if (credential.status === "revoked") return { outcome: "revoked" };
      if (credential.status === "rotated") return { outcome: "expired" };

      const replayMarkerKey = `qr:replay:${sha256(payload.payload.jti)}`;
      const replayMarker = await this.redis.set(
        replayMarkerKey,
        "1",
        "EX",
        RESOLUTION_TTL_SECONDS,
        "NX"
      );
      return replayMarker === "OK"
        ? { credentialId: credential.id, outcome: "success", replayMarkerKey }
        : { outcome: "replayed" };
    }

    if (!is128BitToken(token)) return { outcome: "unknown" };

    const [credential] = await db
      .select({ id: qrCredentials.id, status: qrCredentials.status })
      .from(qrCredentials)
      .where(eq(qrCredentials.tokenHash, sha256(token)))
      .limit(1);
    if (!credential) return { outcome: "unknown" };
    if (credential.status === "revoked") return { outcome: "revoked" };
    if (credential.status === "rotated") return { outcome: "expired" };
    return { credentialId: credential.id, outcome: "success" };
  }

  private async verifyInAppToken(token: string): Promise<{
    payload?: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    expired?: boolean;
  }> {
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
      return { payload };
    } catch (error) {
      if (error instanceof errors.JWTExpired) return { expired: true };
      if (error instanceof errors.JOSEError) return {};
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
