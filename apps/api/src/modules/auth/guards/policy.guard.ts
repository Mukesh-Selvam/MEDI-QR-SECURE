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
import {
  findDocumentPatientOwner,
  findDocumentAccessContext,
  hasActiveConsentScope,
  findAccessRequestPatientOwner,
  findConsentResource,
  findGuardianWardOwnerIds,
  findPatientOwner,
  findPatientOwnerByUserId,
  hasActiveFacilityPatientRelationship,
  type PatientOwner,
} from "../patient-access.js";

type ResolvedPatient = PatientOwner;

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
    const patientIdHeader = request.headers?.["x-mediqr-patient-id"];
    const resourceId =
      params?.id ??
      params?.patientId ??
      (typeof patientIdHeader === "string" ? patientIdHeader : "system");

    try {
      const clinicianSessionAction =
        policy.resource === "auth" &&
        (policy.action === "read" || policy.action === "logout");
      const verifiedClinicianRequest =
        policy.resource === "access-request" &&
        user.role === "clinician" &&
        user.isVerified === true &&
        (policy.action === "create" || policy.action === "approve-with-otp");
      const verifiedClinicianConsentRead =
        policy.resource === "consent" &&
        policy.action === "read" &&
        user.role === "clinician" &&
        user.isVerified === true;
      const clinicianDocumentRead =
        policy.resource === "document" &&
        policy.action === "read" &&
        user.role === "clinician" &&
        user.isVerified === true;
      if (
        user.role === "clinician" &&
        !clinicianSessionAction &&
        !verifiedClinicianRequest &&
        !verifiedClinicianConsentRead &&
        !clinicianDocumentRead
      ) {
        throw new ForbiddenException(
          "Clinician access is unavailable without an approved consent"
        );
      }

      let patient: ResolvedPatient | undefined;
      let documentType: string | undefined;
      let hasConsentGrant = false;
      let consentResource:
        | Awaited<ReturnType<typeof findConsentResource>>
        | undefined;
      if (
        policy.resource === "document" &&
        policy.action === "read"
      ) {
        if (params?.patientId) {
          patient = await findPatientOwner(params.patientId);
        } else if (params?.id) {
          const context = await findDocumentAccessContext(params.id);
          patient = context?.patient;
          documentType = context?.documentType;
        }
        if (!patient) {
          throw new ForbiddenException("Document or patient record not found");
        }
      }
      if (
        policy.resource === "document" &&
        policy.action === "create"
      ) {
        patient = await this.resolveDocumentPatient(request, params, policy);
        if (!patient) {
          throw new ForbiddenException("Document or patient record not found");
        }
      }

      if (
        policy.resource === "patient" &&
        (policy.action === "read" || policy.action === "update")
      ) {
        patient = params?.id
          ? await findPatientOwner(params.id)
          : await findPatientOwnerByUserId(user.id);
        if (!patient) {
          throw new ForbiddenException("Patient record not found");
        }
      }

      if (
        policy.resource === "access-request" &&
        !["create", "list"].includes(policy.action) &&
        params?.id
      ) {
        patient = await findAccessRequestPatientOwner(params.id);
        if (!patient) {
          throw new ForbiddenException("Access request not found");
        }
      }
      if (
        policy.resource === "consent" &&
        ["read", "revoke"].includes(policy.action) &&
        params?.id
      ) {
        consentResource = await findConsentResource(params.id);
        patient = consentResource?.patient;
        if (!patient || !consentResource) {
          throw new ForbiddenException("Consent not found");
        }
      }

      if (clinicianDocumentRead && patient && user.isVerified === true) {
        const requiredScope = params?.patientId
          ? "timeline"
          : documentType
            ? `document:${documentType}`
            : undefined;
        if (requiredScope) {
          hasConsentGrant = await hasActiveConsentScope(
            patient.id,
            user.id,
            requiredScope
          );
        }
        if (!hasConsentGrant) {
          throw new ForbiddenException("No active consent covers this record");
        }
      }

      const guardianWardIds =
        user.role === "guardian"
          ? await findGuardianWardOwnerIds(user.id)
          : [];
      const hasPatientRelationship =
        patient &&
        user.facilityId &&
        (user.role === "facility-admin" || user.role === "pharmacy-staff")
          ? await hasActiveFacilityPatientRelationship(user.facilityId, patient.id)
          : false;

      const decision = await this.cerbos.checkResource({
        principal: {
          id: user.id,
          roles: [user.role],
          attributes: {
            is_verified: user.isVerified ?? false,
            has_access_grant: hasConsentGrant,
            has_consent_grant: hasConsentGrant,
            has_scope: hasConsentGrant,
            has_patient_relationship: hasPatientRelationship,
            guardian_ward_ids: guardianWardIds,
            facility_id: user.facilityId ?? "",
          },
        },
        resource: {
          kind: policy.resource,
          id: policy.resource === "patient" ? patient?.id ?? resourceId : resourceId,
          attributes: {
            owner_id: patient?.userId ?? "",
            ...(patient ? { patient_id: patient.id } : {}),
            ...(documentType ? { document_type: documentType } : {}),
            ...(consentResource
              ? {
                  grantee_id: consentResource.granteeUserId,
                  status: consentResource.status,
                  expires_at: consentResource.expiresAt.toISOString(),
                }
              : {}),
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

  private async resolveDocumentPatient(
    request: FastifyRequest,
    params: Record<string, string> | undefined,
    policy: PolicyMetadata
  ): Promise<ResolvedPatient | undefined> {
    if (policy.action === "create") {
      const patientId = request.headers["x-mediqr-patient-id"];
      return typeof patientId === "string"
        ? findPatientOwner(patientId)
        : undefined;
    }

    if (params?.patientId) return findPatientOwner(params.patientId);
    return params?.id ? findDocumentPatientOwner(params.id) : undefined;
  }
}
