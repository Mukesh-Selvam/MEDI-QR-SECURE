/**
 * PolicyGuard — deny-by-default Cerbos PDP evaluator.
 *
 * Requires every route to carry @RequirePolicy() OR @PublicRoute().
 * Missing declaration -> throws 403 (caught by the route-audit test).
 */
import {
  CanActivate,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GRPC } from "@cerbos/grpc";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  POLICY_KEY,
  type PolicyMetadata,
} from "../decorators/policy.decorator.js";
import { PUBLIC_ROUTE_KEY } from "../decorators/public.decorator.js";
import type { AuthenticatedUser } from "../decorators/current-user.decorator.js";
import type { FastifyRequest } from "fastify";
import { env } from "../../../config/env.js";
import { db } from "../../../database/index.js";
import {
  emergencyAccessRequests,
  emergencyProfiles,
  facilities,
  facilityStaffAffiliations,
  patients,
  users,
} from "../../../database/schema.js";
import {
  findDocumentPatientOwner,
  findDocumentAccessContext,
  hasActiveConsentScope,
  findAccessRequestPatientOwner,
  findAccessRequestPolicyContext,
  findActiveRequestConsentContext,
  findConsentResource,
  findGuardianWardOwnerIds,
  findNotificationRecipient,
  findPatientOwner,
  findPatientOwnerByUserId,
  hasActiveFacilityPatientRelationship,
  type PatientOwner,
} from "../patient-access.js";

type ResolvedPatient = PatientOwner;
const EMERGENCY_PROFILE_UNAVAILABLE = "Emergency profile unavailable.";
type EmergencyStaffRole = "emergency-department-staff" | "pharmacy-staff";

function isEmergencyStaffRole(role: string): role is EmergencyStaffRole {
  return role === "emergency-department-staff" || role === "pharmacy-staff";
}

@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly cerbos: GRPC;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    const host =
      env.CERBOS_HOST === "localhost" ? "127.0.0.1" : env.CERBOS_HOST;
    this.cerbos = new GRPC(`${host}:${env.CERBOS_PORT}`, { tls: false });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (isPublic) return true;

    const policy = this.reflector.getAllAndOverride<PolicyMetadata | undefined>(
      POLICY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!policy) {
      // Route has no explicit policy declaration -> deny-by-default
      throw new ForbiddenException(
        "Route missing @RequirePolicy() or @PublicRoute() declaration",
      );
    }

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as unknown as Record<string, unknown>)["user"] as
      AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException("Unauthenticated");
    }

    const params = request.params as Record<string, string> | undefined;
    const patientIdHeader = request.headers?.["x-mediqr-patient-id"];
    const resourceId =
      params?.id ??
      params?.facilityId ??
      params?.affiliationId ??
      params?.patientId ??
      params?.requestId ??
      (typeof patientIdHeader === "string" ? patientIdHeader : "system");

    try {
      const clinicianSessionAction =
        policy.resource === "auth" &&
        (policy.action === "read" || policy.action === "logout");
      const verifiedClinicianRequest =
        policy.resource === "access-request" &&
        user.role === "clinician" &&
        user.isVerified === true &&
        (policy.action === "create" ||
          policy.action === "approve-with-otp" ||
          policy.action === "read-status");
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
        if (policy.resource === "emergency-profile") {
          throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
        }
        throw new ForbiddenException(
          "Clinician access is unavailable without an approved consent",
        );
      }

      let patient: ResolvedPatient | undefined;
      let documentType: string | undefined;
      let hasConsentGrant = false;
      let consentResource:
        Awaited<ReturnType<typeof findConsentResource>> | undefined;
      let notificationOwnerId: string | undefined;
      let requestGranteeId: string | undefined;
      let requestConsentContext:
        Awaited<ReturnType<typeof findActiveRequestConsentContext>> | undefined;
      let facilityIds: string[] = [];
      let facilityPolicyAttributes: Record<string, unknown> = {};
      let affiliationPolicyAttributes: Record<string, unknown> = {};
      let emergencyPrincipalAttributes: Record<string, unknown> = {};
      let emergencyResourceAttributes: Record<string, unknown> = {};

      if (
        policy.resource === "emergency-access" ||
        policy.resource === "facility-affiliation"
      ) {
        const rows = await db
          .select({
            facilityId: facilityStaffAffiliations.facilityId,
            role: facilityStaffAffiliations.role,
          })
          .from(facilityStaffAffiliations)
          .where(
            and(
              eq(facilityStaffAffiliations.userId, user.id),
              eq(facilityStaffAffiliations.status, "active"),
            ),
          );
        facilityIds = rows
          .filter(({ role }) => role === user.role)
          .map(({ facilityId }) => facilityId);
      }

      if (policy.resource === "emergency-access") {
        const requestId = params?.requestId ?? params?.id;
        if (policy.action === "read-summary" && requestId) {
          const [context] = await db
            .select({
              patientId: emergencyAccessRequests.patientId,
              patientUserId: patients.userId,
              requesterUserId: emergencyAccessRequests.requesterUserId,
              facilityId: emergencyAccessRequests.facilityId,
              facilityType: facilities.facilityType,
              facilityStatus: facilities.verificationStatus,
              providerType: emergencyAccessRequests.providerType,
              requestStatus: emergencyAccessRequests.status,
              expiresAt: emergencyAccessRequests.expiresAt,
              profileEnabled: emergencyProfiles.enabled,
            })
            .from(emergencyAccessRequests)
            .innerJoin(
              patients,
              eq(emergencyAccessRequests.patientId, patients.id),
            )
            .innerJoin(
              facilities,
              eq(emergencyAccessRequests.facilityId, facilities.id),
            )
            .leftJoin(
              emergencyProfiles,
              eq(
                emergencyAccessRequests.patientId,
                emergencyProfiles.patientId,
              ),
            )
            .where(eq(emergencyAccessRequests.id, requestId))
            .limit(1);

          if (context) {
            patient = {
              id: context.patientId,
              userId: context.patientUserId,
            };
            requestGranteeId = context.requesterUserId;
            facilityPolicyAttributes = {
              facility_id: context.facilityId,
              facility_type: context.facilityType,
              facility_status: context.facilityStatus,
            };
            const [affiliation] = isEmergencyStaffRole(user.role)
              ? await db
                  .select({ status: facilityStaffAffiliations.status })
                  .from(facilityStaffAffiliations)
                  .where(
                    and(
                      eq(
                        facilityStaffAffiliations.facilityId,
                        context.facilityId,
                      ),
                      eq(facilityStaffAffiliations.userId, user.id),
                      eq(facilityStaffAffiliations.role, user.role),
                      eq(facilityStaffAffiliations.status, "active"),
                    ),
                  )
                  .limit(1)
              : [];
            emergencyPrincipalAttributes = {
              facility_id: context.facilityId,
              provider_type: context.facilityType,
              facility_status: context.facilityStatus,
              staff_status: affiliation?.status ?? "",
            };
            emergencyResourceAttributes = {
              grant_owner_id: context.patientUserId,
              grantee_id: context.requesterUserId,
              provider_type: context.providerType,
              profile_enabled: context.profileEnabled ?? false,
              grant_active:
                context.requestStatus === "granted" &&
                context.expiresAt !== null &&
                context.expiresAt > new Date(),
            };
          }
        } else {
          const facilityId = params?.facilityId;
          if (facilityId) {
            const parsedFacilityId = z.string().uuid().safeParse(facilityId);
            if (!parsedFacilityId.success) {
              throw new BadRequestException("Invalid facility identifier.");
            }
            const [facility] = await db
              .select({
                id: facilities.id,
                type: facilities.facilityType,
                status: facilities.verificationStatus,
              })
              .from(facilities)
              .where(eq(facilities.id, facilityId))
              .limit(1);
            facilityPolicyAttributes = {
              facility_id: facility?.id ?? "",
              facility_type: facility?.type ?? "",
              facility_status: facility?.status ?? "",
            };
            const [affiliation] = isEmergencyStaffRole(user.role)
              ? await db
                  .select({ status: facilityStaffAffiliations.status })
                  .from(facilityStaffAffiliations)
                  .where(
                    and(
                      eq(facilityStaffAffiliations.facilityId, facilityId),
                      eq(facilityStaffAffiliations.userId, user.id),
                      eq(facilityStaffAffiliations.role, user.role),
                      eq(facilityStaffAffiliations.status, "active"),
                    ),
                  )
                  .limit(1)
              : [];
            emergencyPrincipalAttributes = {
              facility_id: facility?.id ?? "",
              provider_type: facility?.type ?? "",
              facility_status: facility?.status ?? "",
              staff_status: affiliation?.status ?? "",
            };
            emergencyResourceAttributes = {
              provider_type: facility?.type ?? "",
            };
          }
        }
      }

      if (policy.resource === "facility-affiliation") {
        const facilityId = params?.facilityId;
        const affiliationId = params?.affiliationId;
        for (const routeId of [facilityId, affiliationId]) {
          if (routeId && !z.string().uuid().safeParse(routeId).success) {
            throw new BadRequestException(
              "Invalid facility affiliation identifier.",
            );
          }
        }
        const [facility] = facilityId
          ? await db
              .select({
                id: facilities.id,
                type: facilities.facilityType,
                status: facilities.verificationStatus,
              })
              .from(facilities)
              .where(eq(facilities.id, facilityId))
              .limit(1)
          : [];
        const requestBody =
          request.body && typeof request.body === "object"
            ? (request.body as Record<string, unknown>)
            : {};
        const targetUserId =
          typeof requestBody.userId === "string" ? requestBody.userId : "";
        const parsedTargetUserId = z.string().uuid().safeParse(targetUserId);
        const [targetUser] = parsedTargetUserId.success
          ? await db
              .select({ id: users.id, role: users.role, status: users.status })
              .from(users)
              .where(eq(users.id, parsedTargetUserId.data))
              .limit(1)
          : [];

        const [affiliation] = affiliationId
          ? await db
              .select({
                id: facilityStaffAffiliations.id,
                facilityId: facilityStaffAffiliations.facilityId,
                facilityType: facilities.facilityType,
                facilityStatus: facilities.verificationStatus,
                userId: facilityStaffAffiliations.userId,
                role: facilityStaffAffiliations.role,
                status: facilityStaffAffiliations.status,
                platformSuspended: facilityStaffAffiliations.platformSuspended,
              })
              .from(facilityStaffAffiliations)
              .innerJoin(
                facilities,
                eq(facilityStaffAffiliations.facilityId, facilities.id),
              )
              .where(eq(facilityStaffAffiliations.id, affiliationId))
              .limit(1)
          : [];

        facilityPolicyAttributes = {
          facility_id: facility?.id ?? affiliation?.facilityId ?? "",
          facility_type: facility?.type ?? affiliation?.facilityType ?? "",
          facility_status:
            facility?.status ?? affiliation?.facilityStatus ?? "",
        };
        affiliationPolicyAttributes = {
          affiliation_user_id: affiliation?.userId ?? targetUser?.id ?? "",
          affiliation_role: affiliation?.role ?? targetUser?.role ?? "",
          affiliation_status: affiliation?.status ?? "",
          platform_suspended: affiliation?.platformSuspended ?? false,
          requested_role: targetUser?.role ?? "",
          target_user_status: targetUser?.status ?? "",
        };
      }
      if (
        policy.resource === "notification" &&
        policy.action === "update" &&
        params?.id
      ) {
        notificationOwnerId = await findNotificationRecipient(params.id);
        if (!notificationOwnerId) {
          throw new ForbiddenException("Notification not found");
        }
      }
      if (policy.resource === "document" && policy.action === "read") {
        if (params?.requestId) {
          if (user.role !== "clinician" || user.isVerified !== true) {
            throw new ForbiddenException(
              "Verified clinician access is required",
            );
          }
          requestConsentContext = await findActiveRequestConsentContext(
            params.requestId,
            user.id,
          );
          patient = requestConsentContext
            ? await findPatientOwner(requestConsentContext.patientId)
            : undefined;
          hasConsentGrant =
            requestConsentContext !== undefined &&
            (requestConsentContext.scope.includes("timeline") ||
              requestConsentContext.scope.some((scope) =>
                scope.startsWith("document:"),
              ));
        } else if (params?.patientId) {
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
        policy.resource === "emergency-document" &&
        policy.action === "update-emergency-visibility" &&
        params?.documentId
      ) {
        const context = await findDocumentAccessContext(params.documentId);
        patient = context?.patient;
        documentType = context?.documentType;
        if (!patient || !documentType) {
          throw new ForbiddenException(
            "Emergency document visibility unavailable.",
          );
        }
      }
      if (policy.resource === "document" && policy.action === "create") {
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
        policy.resource === "emergency-profile" &&
        (policy.action === "read" || policy.action === "update")
      ) {
        patient = params?.patientId
          ? await findPatientOwner(params.patientId)
          : undefined;
        if (!patient) {
          throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
        }
        if (user.role !== "patient" && user.role !== "guardian") {
          throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
        }
      }

      if (
        policy.resource === "access-request" &&
        !["create", "list"].includes(policy.action) &&
        params?.id
      ) {
        if (policy.action === "read-status") {
          const requestContext = await findAccessRequestPolicyContext(
            params.id,
          );
          if (
            user.role !== "clinician" ||
            user.isVerified !== true ||
            requestContext?.clinicianUserId !== user.id
          ) {
            throw new ForbiddenException("Access request not found");
          }
          patient = requestContext.patient;
          requestGranteeId = requestContext.clinicianUserId;
        } else {
          patient = await findAccessRequestPatientOwner(params.id);
        }
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
        const requiredScope = params?.requestId
          ? undefined
          : params?.patientId
            ? "timeline"
            : documentType
              ? `document:${documentType}`
              : undefined;
        if (requiredScope) {
          hasConsentGrant = await hasActiveConsentScope(
            patient.id,
            user.id,
            requiredScope,
          );
        }
        if (!hasConsentGrant) {
          throw new ForbiddenException("No active consent covers this record");
        }
      }

      const guardianWardIds =
        user.role === "guardian" ? await findGuardianWardOwnerIds(user.id) : [];
      const hasPatientRelationship =
        patient &&
        user.facilityId &&
        (user.role === "facility-admin" || user.role === "pharmacy-staff")
          ? await hasActiveFacilityPatientRelationship(
              user.facilityId,
              patient.id,
            )
          : false;

      const decision = await this.cerbos.checkResource({
        principal: {
          id: user.id,
          roles: [user.role],
          attributes: {
            is_verified: user.isVerified ?? false,
            is_mfa_verified: user.isMfaVerified ?? false,
            has_access_grant: hasConsentGrant,
            has_consent_grant: hasConsentGrant,
            has_scope: hasConsentGrant,
            has_patient_relationship: hasPatientRelationship,
            guardian_ward_ids: guardianWardIds,
            facility_id: user.facilityId ?? "",
            facility_ids: facilityIds,
            ...emergencyPrincipalAttributes,
          },
        },
        resource: {
          kind: policy.resource,
          id:
            policy.resource === "patient" ||
            policy.resource === "emergency-profile"
              ? (patient?.id ?? resourceId)
              : resourceId,
          attributes: {
            owner_id:
              policy.resource === "notification"
                ? (notificationOwnerId ?? user.id)
                : (patient?.userId ?? ""),
            ...(patient ? { patient_id: patient.id } : {}),
            ...(documentType ? { document_type: documentType } : {}),
            ...(consentResource
              ? {
                  grantee_id: consentResource.granteeUserId,
                  status: consentResource.status,
                  expires_at: consentResource.expiresAt.toISOString(),
                }
              : {}),
            ...(requestGranteeId ? { grantee_id: requestGranteeId } : {}),
            ...facilityPolicyAttributes,
            ...affiliationPolicyAttributes,
            ...emergencyResourceAttributes,
          },
        },
        actions: [policy.action],
      });

      const isAllowed = decision.isAllowed(policy.action);
      if (!isAllowed) {
        if (policy.resource === "emergency-profile") {
          throw new ForbiddenException(EMERGENCY_PROFILE_UNAVAILABLE);
        }
        throw new ForbiddenException(
          `Access denied: ${user.role} cannot perform '${policy.action}' on '${policy.resource}'`,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      if (err instanceof BadRequestException) {
        throw err;
      }
      // Fail closed: if policy engine is unreachable or errors, answer is deny (Condition 5)
      throw new ForbiddenException(
        "Authorization policy engine unavailable (fail-closed)",
      );
    }
  }

  private async resolveDocumentPatient(
    request: FastifyRequest,
    params: Record<string, string> | undefined,
    policy: PolicyMetadata,
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
