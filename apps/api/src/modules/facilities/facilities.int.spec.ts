import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../database/index.js";
import {
  auditEvents,
  facilities,
  facilityStaffAffiliations,
  facilityStaffInvitations,
  users,
} from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { FacilitiesService } from "./facilities.service.js";

describe("Facility verification and affiliations (integration)", () => {
  const suffix = randomUUID();
  const service = new FacilitiesService(new AuditService());
  const userIds: string[] = [];
  const facilityIds: string[] = [];
  let platformAdmin: AuthenticatedUser;
  let facilityAdmin: AuthenticatedUser;
  let secondFacilityAdminId: string;
  let edStaffId: string;
  let pharmacyStaffId: string;

  beforeAll(async () => {
    const created = await db
      .insert(users)
      .values([
        { role: "platform-admin", status: "active" },
        { role: "facility-admin", status: "active" },
        { role: "facility-admin", status: "active" },
        { role: "emergency-department-staff", status: "active" },
        { role: "pharmacy-staff", status: "active" },
      ])
      .returning({ id: users.id, role: users.role });

    for (const user of created) userIds.push(user.id);
    const adminUser = created.find(({ role }) => role === "platform-admin");
    const facilityAdminUsers = created.filter(
      ({ role }) => role === "facility-admin",
    );
    const facilityAdminUser = facilityAdminUsers[0];
    const otherFacilityAdminUser = facilityAdminUsers[1];
    const edStaff = created.find(
      ({ role }) => role === "emergency-department-staff",
    );
    const pharmacyStaff = created.find(({ role }) => role === "pharmacy-staff");
    if (
      !adminUser ||
      !facilityAdminUser ||
      !otherFacilityAdminUser ||
      !edStaff ||
      !pharmacyStaff
    ) {
      throw new Error("Fake facility integration users were not created.");
    }

    platformAdmin = {
      id: adminUser.id,
      sub: adminUser.id,
      role: "platform-admin",
    };
    facilityAdmin = {
      id: facilityAdminUser.id,
      sub: facilityAdminUser.id,
      role: "facility-admin",
    };
    secondFacilityAdminId = otherFacilityAdminUser.id;
    edStaffId = edStaff.id;
    pharmacyStaffId = pharmacyStaff.id;
  });

  afterAll(async () => {
    if (facilityIds.length > 0) {
      await db
        .delete(facilityStaffAffiliations)
        .where(inArray(facilityStaffAffiliations.facilityId, facilityIds));
      await db.delete(facilities).where(inArray(facilities.id, facilityIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("enforces platform verification, facility-scoped staff approval, and platform suspension precedence", async () => {
    const facility = await service.createFacility(
      {
        facilityType: "hospital-emergency-department",
        displayName: `FAKE Emergency Hospital ${suffix}`,
        registrationNumber: `FAKE-REG-${suffix}`,
        registrationJurisdiction: "FAKE-IND",
      },
      platformAdmin,
      "127.0.0.1",
      "integration-test",
    );
    facilityIds.push(facility.id);
    expect(facility.verificationStatus).toBe("pending");

    const otherFacility = await service.createFacility(
      {
        facilityType: "pharmacy",
        displayName: `FAKE Pharmacy ${suffix}`,
        registrationNumber: `FAKE-PHARM-${suffix}`,
        registrationJurisdiction: "FAKE-IND",
      },
      platformAdmin,
      "127.0.0.1",
      "integration-test",
    );
    facilityIds.push(otherFacility.id);
    await service.createFacilityAdminAffiliation(
      otherFacility.id,
      { userId: secondFacilityAdminId },
      platformAdmin,
      "127.0.0.1",
    );
    await expect(
      service.createStaffAffiliation(
        otherFacility.id,
        { userId: pharmacyStaffId },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow(
      "An active facility administrator affiliation is required",
    );

    const adminAffiliation = await service.createFacilityAdminAffiliation(
      facility.id,
      { userId: facilityAdmin.id },
      platformAdmin,
      "127.0.0.1",
    );
    expect(adminAffiliation.status).toBe("active");
    const otherAdminAffiliation = await service.createFacilityAdminAffiliation(
      facility.id,
      { userId: secondFacilityAdminId },
      platformAdmin,
      "127.0.0.1",
    );
    await expect(
      service.updateStaffAffiliation(
        facility.id,
        otherAdminAffiliation.id,
        "suspend",
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("manage only matching ED or pharmacy staff");

    await expect(
      service.createFacilityAdminAffiliation(
        facility.id,
        { userId: facilityAdmin.id },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Only platform administrators");
    await expect(
      service.createStaffAffiliation(
        facility.id,
        { userId: pharmacyStaffId },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("does not match the facility type");
    await expect(
      service.createStaffAffiliation(
        facility.id,
        { userId: facilityAdmin.id },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("cannot create or manage facility-administrator");

    const staffAffiliation = await service.createStaffAffiliation(
      facility.id,
      { userId: edStaffId },
      facilityAdmin,
      "127.0.0.1",
    );
    expect(staffAffiliation.status).toBe("pending");
    expect(staffAffiliation.role).toBe("emergency-department-staff");

    const invitedStaff: AuthenticatedUser = {
      id: edStaffId,
      sub: edStaffId,
      role: "emergency-department-staff",
      isMfaVerified: true,
    };
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        staffAffiliation.id,
        { invitationToken: staffAffiliation.invitationToken },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        staffAffiliation.id,
        { invitationToken: staffAffiliation.invitationToken },
        {
          id: pharmacyStaffId,
          sub: pharmacyStaffId,
          role: "pharmacy-staff",
          isMfaVerified: true,
        },
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        staffAffiliation.id,
        { invitationToken: staffAffiliation.invitationToken },
        { ...invitedStaff, isMfaVerified: false },
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");

    await db
      .update(facilityStaffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(
        eq(facilityStaffInvitations.affiliationId, staffAffiliation.id),
      );
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        staffAffiliation.id,
        { invitationToken: staffAffiliation.invitationToken },
        invitedStaff,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");
    await db
      .update(facilityStaffInvitations)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(
        eq(facilityStaffInvitations.affiliationId, staffAffiliation.id),
      );

    const activeAffiliation = await service.acceptStaffInvitation(
      facility.id,
      staffAffiliation.id,
      { invitationToken: staffAffiliation.invitationToken },
      invitedStaff,
      "127.0.0.1",
    );
    expect(activeAffiliation.status).toBe("active");
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        staffAffiliation.id,
        { invitationToken: staffAffiliation.invitationToken },
        invitedStaff,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");

    const secondFacilityAdmin: AuthenticatedUser = {
      id: secondFacilityAdminId,
      sub: secondFacilityAdminId,
      role: "facility-admin",
    };
    await service.changeVerification(
      otherFacility.id,
      { status: "verified" },
      platformAdmin,
      "127.0.0.1",
    );
    const pharmacyAffiliation = await service.createStaffAffiliation(
      otherFacility.id,
      { userId: pharmacyStaffId },
      secondFacilityAdmin,
      "127.0.0.1",
    );
    expect(pharmacyAffiliation.role).toBe("pharmacy-staff");
    expect(pharmacyAffiliation.status).toBe("pending");

    const locallySuspended = await service.updateStaffAffiliation(
      facility.id,
      staffAffiliation.id,
      "suspend",
      facilityAdmin,
      "127.0.0.1",
    );
    expect(locallySuspended.status).toBe("suspended");
    expect(locallySuspended.platformSuspended).toBe(false);

    const platformSuspended = await service.updateStaffAffiliation(
      facility.id,
      staffAffiliation.id,
      "suspend",
      platformAdmin,
      "127.0.0.1",
    );
    expect(platformSuspended.platformSuspended).toBe(true);

    const revoked = await service.updateStaffAffiliation(
      facility.id,
      staffAffiliation.id,
      "revoke",
      platformAdmin,
      "127.0.0.1",
    );
    expect(revoked.status).toBe("revoked");

    await expect(
      service.changeVerification(
        facility.id,
        { status: "verified" },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Only platform administrators");

    const verified = await service.changeVerification(
      facility.id,
      { status: "verified" },
      platformAdmin,
      "127.0.0.1",
    );
    expect(verified.verificationStatus).toBe("verified");
    expect(verified.verifiedByUserId).toBe(platformAdmin.id);

    const transitionEvents = await db
      .select({
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.resourceId, [
            facility.id,
            adminAffiliation.id,
            staffAffiliation.id,
          ]),
          inArray(auditEvents.action, [
            "FACILITY_CREATED_PENDING",
            "FACILITY_VERIFICATION_PENDING_TO_VERIFIED",
            "FACILITY_ADMIN_AFFILIATION_CREATED_ACTIVE",
            "FACILITY_STAFF_AFFILIATION_CREATED_PENDING",
            "FACILITY_STAFF_AFFILIATION_PENDING_TO_ACTIVE",
            "FACILITY_STAFF_AFFILIATION_ACTIVE_TO_SUSPENDED",
            "FACILITY_STAFF_AFFILIATION_SUSPENDED_TO_PLATFORM_SUSPENDED",
            "FACILITY_STAFF_AFFILIATION_SUSPENDED_TO_REVOKED",
          ]),
        ),
      );
    expect(transitionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: platformAdmin.id,
          action: "FACILITY_CREATED_PENDING",
          resourceId: facility.id,
        }),
        expect.objectContaining({
          actorId: platformAdmin.id,
          action: "FACILITY_VERIFICATION_PENDING_TO_VERIFIED",
          resourceId: facility.id,
        }),
        expect.objectContaining({
          actorId: facilityAdmin.id,
          action: "FACILITY_STAFF_AFFILIATION_CREATED_PENDING",
          resourceId: staffAffiliation.id,
        }),
      ]),
    );
    expect(
      transitionEvents.every(({ resourceId }) =>
        /^[0-9a-f-]{36}$/i.test(resourceId),
      ),
    ).toBe(true);
  });

  it("protects the last active facility administrator from non-platform suspension or revocation", async () => {
    const facility = await service.createFacility(
      {
        facilityType: "hospital-emergency-department",
        displayName: `FAKE Last Admin Hospital ${suffix}`,
        registrationNumber: `FAKE-LAST-ADMIN-${suffix}`,
        registrationJurisdiction: "FAKE-IND",
      },
      platformAdmin,
      "127.0.0.1",
    );
    facilityIds.push(facility.id);

    const lastAdminAffiliation = await service.createFacilityAdminAffiliation(
      facility.id,
      { userId: secondFacilityAdminId },
      platformAdmin,
      "127.0.0.1",
    );

    for (const mutation of ["suspend", "revoke"] as const) {
      await expect(
        service.updateStaffAffiliation(
          facility.id,
          lastAdminAffiliation.id,
          mutation,
          facilityAdmin,
          "127.0.0.1",
        ),
      ).rejects.toThrow("last active facility administrator");
    }

    const [stillActive] = await db
      .select({ status: facilityStaffAffiliations.status })
      .from(facilityStaffAffiliations)
      .where(eq(facilityStaffAffiliations.id, lastAdminAffiliation.id));
    expect(stillActive.status).toBe("active");

    const platformSuspended = await service.updateStaffAffiliation(
      facility.id,
      lastAdminAffiliation.id,
      "suspend",
      platformAdmin,
      "127.0.0.1",
    );
    expect(platformSuspended.status).toBe("suspended");
  });
});
