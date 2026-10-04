/**
 * CsrfGuard — HMAC double-submit cookie pattern.
 *
 * Client sets: X-CSRF-Token header from the __Host-mediqr-csrf cookie value.
 * Guard verifies: HMAC(header) == HMAC(cookie) in constant time.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyRequest } from "fastify";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import { env } from "../../../config/env.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "__Host-mediqr-csrf";
const CSRF_HEADER = "x-csrf-token";

function signToken(token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!STATE_CHANGING_METHODS.has(request.method)) return true;

    if (isPublic) {
      const origin = request.headers.origin;
      const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (origin && !allowedOrigins.includes(origin)) {
        throw new ForbiddenException("Cross-origin authentication request denied");
      }
      if (!request.url.endsWith("/auth/refresh")) return true;
    }

    const cookieRaw =
      (request.cookies as Record<string, string | undefined>)[CSRF_COOKIE];
    const headerRaw = request.headers[CSRF_HEADER] as string | undefined;

    if (!cookieRaw || !headerRaw) {
      throw new ForbiddenException("Missing CSRF token");
    }

    const expected = Buffer.from(signToken(cookieRaw));
    const provided = Buffer.from(signToken(headerRaw));

    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new ForbiddenException("CSRF token mismatch");
    }

    return true;
  }
}
