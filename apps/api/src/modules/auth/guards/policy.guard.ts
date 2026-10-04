/**
 * PolicyGuard — deny-by-default Cerbos PDP evaluator.
 *
 * Requires every route to carry @RequirePolicy() OR @PublicRoute().
 * Missing declaration -> throws 403 (caught by the route-audit test).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GRPC } from "@cerbos/grpc";
import { POLICY_KEY, type PolicyMetadata } from "../decorators/policy.decorator.js";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";
import type { FastifyRequest } from "fastify";
import { env } from "../../../config/env.js";

@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly cerbos: GRPC;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    const host = env.CERBOS_HOST === "localhost" ? "127.0.0.1" : env.CERBOS_HOST;
    this.cerbos = new GRPC(
      `${host}:${env.CERBOS_PORT}`,
      { tls: false }
    );
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const policy = this.reflector.getAllAndOverride<PolicyMetadata | undefined>(
      POLICY_KEY,
      [ctx.getHandler(), ctx.getClass()]
    );

    if (!policy) {
      // Route has no explicit policy declaration -> deny-by-default
      throw new ForbiddenException(
        "Route missing @RequirePolicy() or @PublicRoute() declaration"
      );
    }

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as unknown as Record<string, unknown>)[
      "user"
    ] as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException("Unauthenticated");
    }

    const resourceId =
      (request.params as Record<string, string>)?.id ?? "system";

    try {
      const decision = await this.cerbos.checkResource({
        principal: {
          id: user.id,
          roles: [user.role],
          attributes: {
            is_verified: user.isVerified ?? false,
            has_access_grant: false,
            guardian_ward_ids: user.guardianWardIds ?? [],
            facility_id: user.facilityId ?? "",
          },
        },
        resource: {
          kind: policy.resource,
          id: resourceId,
          attributes: {
            owner_id: resourceId,
          },
        },
        actions: [policy.action],
      });

      const isAllowed = decision.isAllowed(policy.action);
      if (!isAllowed) {
        throw new ForbiddenException(
          `Access denied: ${user.role} cannot perform '${policy.action}' on '${policy.resource}'`
        );
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      // Fail closed: if policy engine is unreachable or errors, answer is deny (Condition 5)
      throw new ForbiddenException(
        "Authorization policy engine unavailable (fail-closed)"
      );
    }
  }
}
