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
import { jwtVerify } from "jose";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";
import { env } from "../../../config/env.js";

const ACCESS_COOKIE = "__Host-mediqr-access";

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
      const { payload } = await jwtVerify(
        token,
        Buffer.from(env.SESSION_SECRET),
        {
          issuer: "mediqr-api",
          audience: "mediqr-api",
        }
      );

      const user: AuthenticatedUser = {
        id: (payload["mediqr_user_id"] as string) ?? payload.sub!,
        sub: payload.sub!,
        role: (payload["role"] as string) ?? "patient",
        isVerified: (payload["is_verified"] as boolean) ?? false,
      };

      (request as unknown as Record<string, unknown>)["user"] = user;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
