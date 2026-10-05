import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import {
  facilities,
  facilityStaffAffiliations,
  users,
} from "../../database/schema.js";
import type { AuditAction, AuditEventInput } from "../audit/audit.types.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import {
  affiliationUserSchema,
  createFacilitySchema,
  facilityVerificationSchema,
  resourceIdSchema,
} from "./facilities.schema.js";

type FacilityAudit = Pick<AuditService, "hashIp" | "logInTransaction">;
type AffiliationStatus =
  (typeof facilityStaffAffiliations.$inferSelect)["status"];
type AffiliationRole =
  (typeof facilityStaffAffiliations.$inferSelect)["role"];
type FacilityType = (typeof facilities.$inferSelect)["facilityType"];
type AffiliationMutation = "activate" | "suspend" | "revoke";

const facilityVerificationActions: Partial<
  Record<string, AuditAction>
> = {
  "pending:verified": "FACILITY_VERIFICATION_PENDING_TO_VERIFIED",
  "pending:rejected": "FACILITY_VERIFICATION_PENDING_TO_REJECTED",
  "pending:suspended": "FACILITY_VERIFICATION_PENDING_TO_SUSPENDED",
  "pending:revoked": "FACILITY_VERIFICATION_PENDING_TO_REVOKED",
  "verified:suspended": "FACILITY_VERIFICATION_VERIFIED_TO_SUSPENDED",
  "verified:revoked": "FACILITY_VERIFICATION_VERIFIED_TO_REVOKED",
  "rejected:verified": "FACILITY_VERIFICATION_REJECTED_TO_VERIFIED",
  "rejected:revoked": "FACILITY_VERIFICATION_REJECTED_TO_REVOKED",
  "suspended:verified": "FACILITY_VERIFICATION_SUSPENDED_TO_VERIFIED",
  "suspended:revoked": "FACILITY_VERIFICATION_SUSPENDED_TO_REVOKED",
};

const staffAffiliationActions: Partial<Record<string, AuditAction>> = {
  "pending:active": "FACILITY_STAFF_AFFILIATION_PENDING_TO_ACTIVE",
  "pending:suspended": "FACILITY_STAFF_AFFILIATION_PENDING_TO_SUSPENDED",
  "active:suspended": "FACILITY_STAFF_AFFILIATION_ACTIVE_TO_SUSPENDED",
  "suspended:active": "FACILITY_STAFF_AFFILIATION_SUSPENDED_TO_ACTIVE",
  "pending:revoked": "FACILITY_STAFF_AFFILIATION_PENDING_TO_REVOKED",
  "active:revoked": "FACILITY_STAFF_AFFILIATION_ACTIVE_TO_REVOKED",
  "suspended:revoked": "FACILITY_STAFF_AFFILIATION_SUSPENDED_TO_REVOKED",
};

const facilityAdminAffiliationActions: Partial<
  Record<string, AuditAction>
> = {
  "active:suspended": "FACILITY_ADMIN_AFFILIATION_ACTIVE_TO_SUSPENDED",
  "active:revoked": "FACILITY_ADMIN_AFFILIATION_ACTIVE_TO_REVOKED",
  "suspended:revoked": "FACILITY_ADMIN_AFFILIATION_SUSPENDED_TO_REVOKED",
};

@Injectable()
export class FacilitiesService {
  constructor(
    @Inject(AuditService) private readonly audit: FacilityAudit,
  ) {}

  async createFacility(
    input: unknown,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ) {
    if (actor.role !== "platform-admin") {
      throw new ForbiddenException("Only platform administrators can create facilities.");
    }
    const parsed = createFacilitySchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid facility registration data.");
    }

    return db.transaction(async (transaction) => {
      const [facility] = await transaction
        .insert(facilities)
        .values({
          ...parsed.data,
          verificationStatus: "pending",
        })
        .onConflictDoNothing({
          target: [
            facilities.registrationJurisdiction,
            facilities.registrationNumber,
          ],
        })
        .returning();
      if (!facility) {
        throw new ConflictException(
          "A facility with this registration already exists.",
        );
      }

      await this.writeAudit(
        {
          actor,
          action: "FACILITY_CREATED_PENDING",
          resourceType: "facility",
          resourceId: facility.id,
          ip,
          userAgent,
        },
        transaction,
      );
      return facility;
    });
  }

  async changeVerification(
    facilityId: string,
    input: unknown,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ) {
    facilityId = this.requireResourceId(facilityId);
    if (actor.role !== "platform-admin") {
      throw new ForbiddenException(
        "Only platform administrators can change facility verification.",
      );
    }
    const parsed = facilityVerificationSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid facility verification status.");
    }

    return db.transaction(async (transaction) => {
      const [facility] = await transaction
        .select()
        .from(facilities)
        .where(eq(facilities.id, facilityId))
        .for("update")
        .limit(1);
      if (!facility) throw new NotFoundException("Facility not found.");

      const [selfAffiliation] = await transaction
        .select({ id: facilityStaffAffiliations.id })
        .from(facilityStaffAffiliations)
        .where(
          and(
            eq(facilityStaffAffiliations.facilityId, facilityId),
            eq(facilityStaffAffiliations.userId, actor.id),
            eq(facilityStaffAffiliations.status, "active"),
          ),
        )
        .limit(1);
      if (selfAffiliation) {
        throw new ForbiddenException(
          "A platform administrator affiliated with a facility cannot change its verification.",
        );
      }

      const nextStatus = parsed.data.status;
      const action =
        facilityVerificationActions[`${facility.verificationStatus}:${nextStatus}`];
      if (!action) {
        throw new ConflictException(
          "The facility cannot transition from its current verification status.",
        );
      }

      const now = new Date();
      const [updated] = await transaction
        .update(facilities)
        .set({
          verificationStatus: nextStatus,
          verifiedByUserId: nextStatus === "verified" ? actor.id : null,
          verifiedAt: nextStatus === "verified" ? now : null,
          updatedAt: now,
        })
        .where(eq(facilities.id, facilityId))
        .returning();
      if (!updated) throw new Error("Facility verification update returned no record.");

      await this.writeAudit(
        {
          actor,
          action,
          resourceType: "facility",
          resourceId: facilityId,
          ip,
          userAgent,
        },
        transaction,
      );
      return updated;
    });
  }

  async createFacilityAdminAffiliation(
    facilityId: string,
    input: unknown,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ) {
    facilityId = this.requireResourceId(facilityId);
    this.requirePlatformAdmin(actor);
    const parsed = affiliationUserSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid facility administrator affiliation.");
    }

    return db.transaction(async (transaction) => {
      await this.requireFacility(transaction, facilityId);
      const target = await this.requireActiveUser(transaction, parsed.data.userId);
      if (target.role !== "facility-admin" || target.id === actor.id) {
        throw new BadRequestException(
          "The selected account cannot be assigned as a facility administrator.",
        );
      }
      await this.requireNoExistingAffiliation(
        transaction,
        facilityId,
        target.id,
      );

      const [affiliation] = await transaction
        .insert(facilityStaffAffiliations)
        .values({
          facilityId,
          userId: target.id,
          role: "facility-admin",
          status: "active",
          createdByUserId: actor.id,
        })
        .onConflictDoNothing({
          target: [
            facilityStaffAffiliations.facilityId,
            facilityStaffAffiliations.userId,
          ],
        })
        .returning();
      if (!affiliation) {
        throw new ConflictException("An affiliation already exists for this account.");
      }

      await this.writeAudit(
        {
          actor,
          action: "FACILITY_ADMIN_AFFILIATION_CREATED_ACTIVE",
          resourceType: "facility_staff_affiliation",
          resourceId: affiliation.id,
          ip,
          userAgent,
        },
        transaction,
      );
      return affiliation;
    });
  }

  async createStaffAffiliation(
    facilityId: string,
    input: unknown,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ) {
    facilityId = this.requireResourceId(facilityId);
    if (actor.role !== "facility-admin") {
      throw new ForbiddenException(
        "Only a facility administrator can create staff affiliations.",
      );
    }
    const parsed = affiliationUserSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid staff affiliation.");
    }

    return db.transaction(async (transaction) => {
      const facility = await this.requireFacility(transaction, facilityId);
      await this.requireFacilityAdmin(transaction, facilityId, actor.id);
      if (
        facility.verificationStatus !== "pending" &&
        facility.verificationStatus !== "verified"
      ) {
        throw new ConflictException(
          "Staff affiliations cannot be created for a facility that is not eligible.",
        );
      }
      const target = await this.requireActiveUser(transaction, parsed.data.userId);
      if (target.id === actor.id || target.role === "facility-admin") {
        throw new ForbiddenException(
          "Facility administrators cannot create or manage facility-administrator affiliations.",
        );
      }
      if (!this.isStaffRoleForFacility(target.role, facility.facilityType)) {
        throw new BadRequestException(
          "The account role does not match the facility type.",
        );
      }
      await this.requireNoExistingAffiliation(
        transaction,
        facilityId,
        target.id,
      );

      const [affiliation] = await transaction
        .insert(facilityStaffAffiliations)
        .values({
          facilityId,
          userId: target.id,
          role: target.role,
          status: "pending",
          createdByUserId: actor.id,
        })
        .onConflictDoNothing({
          target: [
            facilityStaffAffiliations.facilityId,
            facilityStaffAffiliations.userId,
          ],
        })
        .returning();
      if (!affiliation) {
        throw new ConflictException("An affiliation already exists for this account.");
      }

      await this.writeAudit(
        {
          actor,
          action: "FACILITY_STAFF_AFFILIATION_CREATED_PENDING",
          resourceType: "facility_staff_affiliation",
          resourceId: affiliation.id,
          ip,
          userAgent,
        },
        transaction,
      );
      return affiliation;
    });
  }

  async updateStaffAffiliation(
    facilityId: string,
    affiliationId: string,
    mutation: AffiliationMutation,
    actor: AuthenticatedUser,
    ip: string,
    userAgent?: string,
  ) {
    facilityId = this.requireResourceId(facilityId);
    affiliationId = this.requireResourceId(affiliationId);
    if (actor.role !== "facility-admin" && actor.role !== "platform-admin") {
      throw new ForbiddenException("Staff affiliation administration is unavailable.");
    }

    return db.transaction(async (transaction) => {
      const [affiliation] = await transaction
        .select()
        .from(facilityStaffAffiliations)
        .where(
          and(
            eq(facilityStaffAffiliations.id, affiliationId),
            eq(facilityStaffAffiliations.facilityId, facilityId),
          ),
        )
        .for("update")
        .limit(1);
      if (!affiliation) throw new NotFoundException("Affiliation not found.");
      if (affiliation.userId === actor.id) {
        throw new ForbiddenException(
          "Administrators cannot change their own facility affiliation.",
        );
      }

      const facility = await this.requireFacility(transaction, facilityId);
      if (actor.role === "facility-admin") {
        await this.requireFacilityAdmin(transaction, facilityId, actor.id);
        if (
          facility.verificationStatus !== "pending" &&
          facility.verificationStatus !== "verified"
        ) {
          throw new ConflictException(
            "Staff affiliations cannot be activated for a facility that is not eligible.",
          );
        }
        if (
          affiliation.role === "facility-admin" ||
          !this.isStaffRoleForFacility(affiliation.role, facility.facilityType)
        ) {
          throw new ForbiddenException(
            "Facility administrators can manage only matching ED or pharmacy staff.",
          );
        }
        if (mutation === "activate" && affiliation.platformSuspended) {
          throw new ForbiddenException(
            "A platform administrator suspended this affiliation.",
          );
        }
      } else if (mutation === "activate") {
        throw new ForbiddenException(
          "Platform administrators cannot activate staff affiliations.",
        );
      }

      const nextStatus = this.getNextAffiliationStatus(
        affiliation.status,
        mutation,
        affiliation.platformSuspended,
        actor.role,
      );
      const action = this.getAffiliationAction(
        affiliation.role,
        affiliation.status,
        nextStatus,
        mutation,
        affiliation.platformSuspended,
        actor.role,
      );
      const platformSuspended =
        mutation === "suspend" && actor.role === "platform-admin"
          ? true
          : affiliation.platformSuspended;

      const [updated] = await transaction
        .update(facilityStaffAffiliations)
        .set({ status: nextStatus, platformSuspended, updatedAt: new Date() })
        .where(eq(facilityStaffAffiliations.id, affiliationId))
        .returning();
      if (!updated) throw new Error("Affiliation update returned no record.");

      await this.writeAudit(
        {
          actor,
          action,
          resourceType: "facility_staff_affiliation",
          resourceId: affiliationId,
          ip,
          userAgent,
        },
        transaction,
      );
      return updated;
    });
  }

  private async requireFacility(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    facilityId: string,
  ) {
    const [facility] = await transaction
      .select()
      .from(facilities)
      .where(eq(facilities.id, facilityId))
      .for("update")
      .limit(1);
    if (!facility) throw new NotFoundException("Facility not found.");
    return facility;
  }

  private async requireFacilityAdmin(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    facilityId: string,
    userId: string,
  ): Promise<void> {
    const [affiliation] = await transaction
      .select({ id: facilityStaffAffiliations.id })
      .from(facilityStaffAffiliations)
      .where(
        and(
          eq(facilityStaffAffiliations.facilityId, facilityId),
          eq(facilityStaffAffiliations.userId, userId),
          eq(facilityStaffAffiliations.role, "facility-admin"),
          eq(facilityStaffAffiliations.status, "active"),
        ),
      )
      .limit(1);
    if (!affiliation) {
      throw new ForbiddenException(
        "An active facility administrator affiliation is required.",
      );
    }
  }

  private async requireActiveUser(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
  ) {
    const [user] = await transaction
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.status !== "active") {
      throw new NotFoundException("Active staff account not found.");
    }
    return user;
  }

  private async requireNoExistingAffiliation(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    facilityId: string,
    userId: string,
  ): Promise<void> {
    const [existing] = await transaction
      .select({ id: facilityStaffAffiliations.id })
      .from(facilityStaffAffiliations)
      .where(
        and(
          eq(facilityStaffAffiliations.facilityId, facilityId),
          eq(facilityStaffAffiliations.userId, userId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException("An affiliation already exists for this account.");
    }
  }

  private isStaffRoleForFacility(
    role: AffiliationRole,
    facilityType: FacilityType,
  ): boolean {
    return (
      (facilityType === "hospital-emergency-department" &&
        role === "emergency-department-staff") ||
      (facilityType === "pharmacy" && role === "pharmacy-staff")
    );
  }

  private getNextAffiliationStatus(
    current: AffiliationStatus,
    mutation: AffiliationMutation,
    platformSuspended: boolean,
    actorRole: string,
  ): AffiliationStatus {
    if (mutation === "activate") {
      if (
        actorRole !== "facility-admin" ||
        platformSuspended ||
        (current !== "pending" && current !== "suspended")
      ) {
        throw new ConflictException("This affiliation cannot be activated.");
      }
      return "active";
    }

    if (current === "revoked") {
      throw new ConflictException("A revoked affiliation cannot be changed.");
    }
    if (mutation === "suspend") {
      if (current === "suspended" && (platformSuspended || actorRole !== "platform-admin")) {
        throw new ConflictException("This affiliation is already suspended.");
      }
      return "suspended";
    }
    return "revoked";
  }

  private getAffiliationAction(
    role: AffiliationRole,
    current: AffiliationStatus,
    next: AffiliationStatus,
    mutation: AffiliationMutation,
    platformSuspended: boolean,
    actorRole: string,
  ): AuditAction {
    if (
      mutation === "suspend" &&
      actorRole === "platform-admin" &&
      current === "suspended" &&
      !platformSuspended
    ) {
      return role === "facility-admin"
        ? "FACILITY_ADMIN_AFFILIATION_SUSPENDED_TO_PLATFORM_SUSPENDED"
        : "FACILITY_STAFF_AFFILIATION_SUSPENDED_TO_PLATFORM_SUSPENDED";
    }

    const actions =
      role === "facility-admin"
        ? facilityAdminAffiliationActions
        : staffAffiliationActions;
    const action = actions[`${current}:${next}`];
    if (!action) throw new ConflictException("Unsupported affiliation transition.");
    return action;
  }

  private requirePlatformAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== "platform-admin") {
      throw new ForbiddenException("Only platform administrators can create facility administrators.");
    }
  }

  private requireResourceId(value: string): string {
    const parsed = resourceIdSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException("Invalid facility resource identifier.");
    }
    return parsed.data;
  }

  private async writeAudit(
    input: {
      actor: AuthenticatedUser;
      action: AuditAction;
      resourceType: string;
      resourceId: string;
      ip: string;
      userAgent?: string;
    },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<void> {
    const event: AuditEventInput = {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: "SUCCESS",
      ipHash: this.audit.hashIp(input.ip),
      userAgent: input.userAgent,
    };
    await this.audit.logInTransaction(event, transaction);
  }
}
