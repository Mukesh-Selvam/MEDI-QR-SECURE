/**
 * @CurrentUser() — injects the validated JWT principal into a handler parameter.
 */
import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export interface AuthenticatedUser {
  /** Internal DB UUID (opaque; never the phone or email) */
  id: string;
  /** Keycloak subject claim */
  sub: string;
  role: string;
  /** Only set for clinicians after DB lookup */
  isVerified?: boolean;
  /** MFA evidence extracted from a validated Keycloak staff access token */
  isMfaVerified?: boolean;
  /** Guardianship ward IDs loaded from DB for guardians */
  guardianWardIds?: string[];
  /** Facility ID for facility-admin / pharmacy-staff */
  facilityId?: string;
  /** Active server-side session row, present for patient OTP sessions */
  sessionId?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return (request as unknown as Record<string, unknown>)[
      "user"
    ] as AuthenticatedUser;
  },
);
