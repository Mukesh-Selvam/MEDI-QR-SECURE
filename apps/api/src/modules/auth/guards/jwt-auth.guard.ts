/**
 * JwtAuthGuard — validates the __Host-mediqr-access HttpOnly cookie.
 *
 * In dev: validates locally-minted HS256 tokens (SESSION_SECRET).
 * In prod: swap the jwtVerify call to use Keycloak JWKS (OIDC).
 * Passes for @PublicRoute() handlers without touching the cookie.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";
import { env } from "../../../config/env.js";
import { db } from "../../../database/index.js";
import { clinicians, users } from "../../../database/schema.js";
import { eq } from "drizzle-orm";
import { verifyStaffAccessToken } from "../staff-token.js";

const ACCESS_COOKIE = "__Host-mediqr-access";
const STAFF_ROLES = new Set([
  "clinician",
  "facility-admin",
  "pharmacy-staff",
  "platform-admin",
]);
const KEYCLOAK_ISSUER = `${env.KEYCLOAK_BASE_URL.replace(/\/+$/, "")}/realms/${encodeURIComponent(env.KEYCLOAK_REALM)}`;
const STAFF_JWKS = createRemoteJWKSet(
  new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`),
  { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000 }
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token =
      (request.cookies as Record<string, string | undefined>)[ACCESS_COOKIE];

    if (!token) {
      throw new UnauthorizedException("Missing authentication cookie");
    }

    try {
      const { alg } = decodeProtectedHeader(token);
      const payload =
        alg === "HS256"
          ? await this.verifyPatientToken(token)
          : alg === "RS256"
            ? await verifyStaffAccessToken(
                token,
                STAFF_JWKS,
                KEYCLOAK_ISSUER,
                env.KEYCLOAK_CLIENT_ID
              )
            : null;

      if (!payload) {
        throw new UnauthorizedException("Unsupported authentication token");
      }

      const user =
        alg === "HS256"
          ? await this.resolvePatient(payload)
          : await this.resolveStaff(payload);
      (request as unknown as Record<string, unknown>)["user"] = user;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  private async verifyPatientToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, Buffer.from(env.SESSION_SECRET), {
      algorithms: ["HS256"],
      issuer: "mediqr-api",
      audience: "mediqr-api",
      clockTolerance: 5,
    });
    return payload;
  }

  private async resolvePatient(payload: JWTPayload): Promise<AuthenticatedUser> {
    const userId = payload["mediqr_user_id"];
    if (typeof userId !== "string") {
      throw new UnauthorizedException("Patient token has no local user identity");
    }
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.status !== "active" || user.role !== "patient" && user.role !== "guardian") {
      throw new UnauthorizedException("Patient account is not active");
    }

    return {
      id: user.id,
      sub: user.id,
      role: user.role,
      isVerified: true,
      facilityId: user.facilityId ?? undefined,
    };
  }

  private async resolveStaff(payload: JWTPayload): Promise<AuthenticatedUser> {
    if (typeof payload.sub !== "string") {
      throw new UnauthorizedException("Staff token has no subject");
    }
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.keycloakId, payload.sub))
      .limit(1);
    if (!user || user.status !== "active" || !STAFF_ROLES.has(user.role)) {
      throw new UnauthorizedException("Staff account is not active");
    }

    let isVerified = true;
    if (user.role === "clinician") {
      const clinician = await db.query.clinicians.findFirst({
        columns: { isVerified: true },
        where: eq(clinicians.userId, user.id),
      });
      isVerified = clinician?.isVerified ?? false;
    }

    return {
      id: user.id,
      sub: payload.sub,
      role: user.role,
      isVerified,
      facilityId: user.facilityId ?? undefined,
    };
  }
}
