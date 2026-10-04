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
import { db } from "../../../database/index.js";
import { documents, guardianships, patients } from "../../../database/schema.js";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const guardianPatients = alias(patients, "guardian_patient");
const wardPatients = alias(patients, "ward_patient");

interface ResolvedPatient {
  id: string;
  ownerUserId: string;
}

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

    const params = request.params as Record<string, string> | undefined;
    const resourceId = params?.id ?? params?.patientId ?? "system";

    try {
      if (user.role === "clinician") {
        throw new ForbiddenException(
          "Clinician access is unavailable until Phase 3 consent is implemented"
        );
      }

      let patient: ResolvedPatient | undefined;
      if (policy.resource === "document" && policy.action === "read") {
        patient = await this.resolveReadPatient(params);
        if (!patient) {
          throw new ForbiddenException("Document or patient record not found");
        }
      }

      const guardianWardIds =
        user.role === "guardian"
          ? await this.loadGuardianWardOwnerIds(user.id)
          : [];

      const decision = await this.cerbos.checkResource({
        principal: {
          id: user.id,
          roles: [user.role],
          attributes: {
            is_verified: user.isVerified ?? false,
            has_access_grant: false,
            guardian_ward_ids: guardianWardIds,
            facility_id: user.facilityId ?? "",
          },
        },
        resource: {
          kind: policy.resource,
          id: resourceId,
          attributes: {
            owner_id: patient?.ownerUserId ?? "",
            ...(patient ? { patient_id: patient.id } : {}),
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

  private async resolveReadPatient(
    params: Record<string, string> | undefined
  ): Promise<ResolvedPatient | undefined> {
    let patientId = params?.patientId;

    if (!patientId && params?.id) {
      const [document] = await db
        .select({ patientId: documents.patientId })
        .from(documents)
        .where(eq(documents.id, params.id))
        .limit(1);
      patientId = document?.patientId;
    }

    if (!patientId) return undefined;

    const [patient] = await db
      .select({ id: patients.id, ownerUserId: patients.userId })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);

    return patient;
  }

  private async loadGuardianWardOwnerIds(guardianUserId: string): Promise<string[]> {
    const validAt = new Date();
    const wardRows = await db
      .select({ ownerUserId: wardPatients.userId })
      .from(guardianships)
      .innerJoin(
        guardianPatients,
        eq(guardianships.guardianPatientId, guardianPatients.id)
      )
      .innerJoin(wardPatients, eq(guardianships.wardPatientId, wardPatients.id))
      .where(
        and(
          eq(guardianPatients.userId, guardianUserId),
          eq(guardianships.verificationStatus, "verified"),
          or(isNull(guardianships.validUntil), gt(guardianships.validUntil, validAt))
        )
      );

    return [...new Set(wardRows.map(({ ownerUserId }) => ownerUserId))];
  }
}
