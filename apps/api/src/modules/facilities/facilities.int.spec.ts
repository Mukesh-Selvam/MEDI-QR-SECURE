import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../../database/index.js";
import {
  auditEvents,
  emergencyAccessRequests,
  facilities,
  facilityStaffAffiliations,
  facilityStaffInvitations,
  patients,
  users,
} from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import {
  type NotificationEmailProvider,
  type StaffInvitationEmail,
} from "../notifications/notification-email.provider.js";
import { FacilitiesController } from "./facilities.controller.js";
import { FacilitiesService } from "./facilities.service.js";

describe("Facility verification and affiliations (integration)", () => {
  const suffix = randomUUID();
  const deliveredInvitations: StaffInvitationEmail[] = [];
  const emailProvider: NotificationEmailProvider = {
    enabled: true,
    send: vi.fn().mockResolvedValue(undefined),
    sendStaffInvitation: vi.fn(async (invitation) => {
      deliveredInvitations.push(invitation);
    }),
  };
  const service = new FacilitiesService(new AuditService(), emailProvider);
  const controller = new FacilitiesController(service);
  const userIds: string[] = [];
  const facilityIds: string[] = [];
  let platformAdmin: AuthenticatedUser;
  let facilityAdmin: AuthenticatedUser;
  let secondFacilityAdminId: string;
  let edStaffId: string;
  let pharmacyStaffId: string;

  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    const created = await db
      .insert(users)
      .values([
        { role: "platform-admin", status: "active" },
        { role: "facility-admin", status: "active" },
        { role: "facility-admin", status: "active" },
        {
          role: "emergency-department-staff",
          status: "active",
          email: `fake-ed-staff-${suffix}@mediqr.invalid`,
        },
        {
          role: "pharmacy-staff",
          status: "active",
          email: `fake-pharmacy-staff-${suffix}@mediqr.invalid`,
        },
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
        .delete(emergencyAccessRequests)
        .where(inArray(emergencyAccessRequests.facilityId, facilityIds));
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

    const consoleSpies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    const staffInvitationResponse = await controller.createStaffAffiliation(
      facility.id,
      { userId: edStaffId },
      facilityAdmin,
      {
        ip: "127.0.0.1",
        headers: {},
      } as FastifyRequest,
    );
    expect(staffInvitationResponse).toEqual({
      invitationId: expect.any(String),
      status: "pending",
    });
    const staffInvitation = deliveredInvitations.find(
      ({ invitationId }) =>
        invitationId === staffInvitationResponse.invitationId,
    );
    if (!staffInvitation) {
      throw new Error("The staff invitation was not delivered.");
    }
    const invitationToken = staffInvitation.invitationToken;
    expect(JSON.stringify(staffInvitationResponse)).not.toContain(
      invitationToken,
    );
    const [pendingAffiliation] = await db
      .select()
      .from(facilityStaffAffiliations)
      .where(
        and(
          eq(facilityStaffAffiliations.facilityId, facility.id),
          eq(facilityStaffAffiliations.userId, edStaffId),
        ),
      );
    if (!pendingAffiliation) {
      throw new Error("The pending staff affiliation was not created.");
    }
    expect(pendingAffiliation.status).toBe("pending");
    expect(pendingAffiliation.role).toBe("emergency-department-staff");
    const [storedInvitation] = await db
      .select({ tokenHash: facilityStaffInvitations.tokenHash })
      .from(facilityStaffInvitations)
      .where(eq(facilityStaffInvitations.id, staffInvitation.invitationId));
    expect(storedInvitation?.tokenHash).toBe(
      createHash("sha256").update(invitationToken).digest("hex"),
    );
    expect(storedInvitation?.tokenHash).not.toBe(invitationToken);

    const invitedStaff: AuthenticatedUser = {
      id: edStaffId,
      sub: edStaffId,
      role: "emergency-department-staff",
      isMfaVerified: true,
    };
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        pendingAffiliation.id,
        { invitationToken },
        facilityAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        pendingAffiliation.id,
        { invitationToken },
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
        pendingAffiliation.id,
        { invitationToken },
        { ...invitedStaff, isMfaVerified: false },
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");

    await db
      .update(facilityStaffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(facilityStaffInvitations.id, staffInvitation.invitationId));
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        pendingAffiliation.id,
        { invitationToken },
        invitedStaff,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Staff invitation is unavailable.");
    await db
      .update(facilityStaffInvitations)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(facilityStaffInvitations.id, staffInvitation.invitationId));

    const activeAffiliation = await service.acceptStaffInvitation(
      facility.id,
      pendingAffiliation.id,
      { invitationToken },
      invitedStaff,
      "127.0.0.1",
    );
    expect(activeAffiliation.status).toBe("active");
    await expect(
      service.acceptStaffInvitation(
        facility.id,
        pendingAffiliation.id,
        { invitationToken },
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
    expect(pharmacyAffiliation).toEqual({
      invitationId: expect.any(String),
      status: "pending",
    });
    expect(pharmacyAffiliation.status).toBe("pending");

    const locallySuspended = await service.updateStaffAffiliation(
      facility.id,
      pendingAffiliation.id,
      "suspend",
      facilityAdmin,
      "127.0.0.1",
    );
    expect(locallySuspended.status).toBe("suspended");
    expect(locallySuspended.platformSuspended).toBe(false);

    const platformSuspended = await service.updateStaffAffiliation(
      facility.id,
      pendingAffiliation.id,
      "suspend",
      platformAdmin,
      "127.0.0.1",
    );
    expect(platformSuspended.platformSuspended).toBe(true);

    const revoked = await service.updateStaffAffiliation(
      facility.id,
      pendingAffiliation.id,
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
            pendingAffiliation.id,
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
          resourceId: pendingAffiliation.id,
        }),
      ]),
    );
    expect(
      transitionEvents.every(({ resourceId }) =>
        /^[0-9a-f-]{36}$/i.test(resourceId),
      ),
    ).toBe(true);
    const auditEventsForInvitation = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, pendingAffiliation.id));
    expect(JSON.stringify(auditEventsForInvitation)).not.toContain(
      invitationToken,
    );
    const emittedLogs = [
      consoleSpies[0],
      consoleSpies[1],
      consoleSpies[2],
      consoleSpies[3],
    ].flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)));
    expect(emittedLogs.join("\n")).not.toContain(invitationToken);
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

  it("revokes active emergency grants transactionally and never restores old grants", async () => {
    const facility = await service.createFacility(
      {
        facilityType: "hospital-emergency-department",
        displayName: `FAKE Grant Revocation Hospital ${suffix}`,
        registrationNumber: `FAKE-GRANT-REVOKE-${suffix}`,
        registrationJurisdiction: "FAKE-IND",
      },
      platformAdmin,
      "127.0.0.1",
    );
    facilityIds.push(facility.id);
    await service.changeVerification(
      facility.id,
      { status: "verified" },
      platformAdmin,
      "127.0.0.1",
    );

    const [staff] = await db
      .insert(users)
      .values({ role: "emergency-department-staff", status: "active" })
      .returning({ id: users.id });
    const [patientUser] = await db
      .insert(users)
      .values({ role: "patient", status: "active" })
      .returning({ id: users.id });
    if (!staff || !patientUser) {
      throw new Error("Fake grant-revocation users were not created.");
    }
    userIds.push(staff.id, patientUser.id);

    const [patient] = await db
      .insert(patients)
      .values({
        userId: patientUser.id,
        healthId: `FAKE-GRANT-REVOKE-${suffix}`,
        fullName: "Fake Grant Revocation Patient",
        phoneHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        encryptedPhone: "fake-test-ciphertext",
      })
      .returning({ id: patients.id });
    if (!patient)
      throw new Error("Fake grant-revocation patient was not created.");

    const [affiliation] = await db
      .insert(facilityStaffAffiliations)
      .values({
        facilityId: facility.id,
        userId: staff.id,
        role: "emergency-department-staff",
        status: "active",
      })
      .returning({ id: facilityStaffAffiliations.id });
    if (!affiliation) {
      throw new Error("Fake active staff affiliation was not created.");
    }

    const now = new Date();
    const expiredGrantedAt = new Date(now.getTime() - 60 * 60 * 1000);
    const [activeGrant, secondActiveGrant, expiredGrant] = await db
      .insert(emergencyAccessRequests)
      .values([
        {
          patientId: patient.id,
          requesterUserId: staff.id,
          facilityId: facility.id,
          providerType: "hospital-emergency-department",
          reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
          status: "granted",
          grantedAt: now,
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        },
        {
          patientId: patient.id,
          requesterUserId: staff.id,
          facilityId: facility.id,
          providerType: "hospital-emergency-department",
          reasonCode: "GUARDIAN_UNAVAILABLE",
          status: "granted",
          grantedAt: now,
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        },
        {
          patientId: patient.id,
          requesterUserId: staff.id,
          facilityId: facility.id,
          providerType: "hospital-emergency-department",
          reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
          status: "granted",
          grantedAt: expiredGrantedAt,
          expiresAt: new Date(expiredGrantedAt.getTime() + 30 * 60 * 1000),
        },
      ])
      .returning({ id: emergencyAccessRequests.id });
    if (!activeGrant || !secondActiveGrant || !expiredGrant) {
      throw new Error("Fake emergency grant fixtures were not created.");
    }

    const audit = new AuditService();
    const failingAudit: Pick<AuditService, "hashIp" | "logInTransaction"> = {
      hashIp: (ip) => audit.hashIp(ip),
      logInTransaction: async (event, transaction) => {
        if (event.action === "EMERGENCY_ACCESS_REVOKED_STAFF_AFFILIATION") {
          throw new Error("Emergency revocation audit unavailable.");
        }
        return audit.logInTransaction(event, transaction);
      },
    };
    const failingService = new FacilitiesService(failingAudit, emailProvider);
    await expect(
      failingService.updateStaffAffiliation(
        facility.id,
        affiliation.id,
        "suspend",
        platformAdmin,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Emergency revocation audit unavailable.");

    const [unmodifiedAffiliation] = await db
      .select({ status: facilityStaffAffiliations.status })
      .from(facilityStaffAffiliations)
      .where(eq(facilityStaffAffiliations.id, affiliation.id));
    const grantsAfterRollback = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
      })
      .from(emergencyAccessRequests)
      .where(
        inArray(emergencyAccessRequests.id, [
          activeGrant.id,
          secondActiveGrant.id,
          expiredGrant.id,
        ]),
      );
    expect(unmodifiedAffiliation?.status).toBe("active");
    expect(grantsAfterRollback).toEqual(
      expect.arrayContaining([
        { id: activeGrant.id, status: "granted" },
        { id: secondActiveGrant.id, status: "granted" },
        { id: expiredGrant.id, status: "granted" },
      ]),
    );

    await service.updateStaffAffiliation(
      facility.id,
      affiliation.id,
      "suspend",
      platformAdmin,
      "127.0.0.1",
    );
    const grantsAfterSuspension = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
        revokedAt: emergencyAccessRequests.revokedAt,
      })
      .from(emergencyAccessRequests)
      .where(
        inArray(emergencyAccessRequests.id, [
          activeGrant.id,
          secondActiveGrant.id,
          expiredGrant.id,
        ]),
      );
    expect(grantsAfterSuspension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: activeGrant.id,
          status: "revoked",
          revokedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: secondActiveGrant.id,
          status: "revoked",
          revokedAt: expect.any(Date),
        }),
        { id: expiredGrant.id, status: "granted", revokedAt: null },
      ]),
    );

    const initialRevocationAudits = await db
      .select({
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.resourceId, [
            affiliation.id,
            activeGrant.id,
            secondActiveGrant.id,
            expiredGrant.id,
          ]),
          eq(auditEvents.action, "EMERGENCY_ACCESS_REVOKED_STAFF_AFFILIATION"),
        ),
      );
    expect(initialRevocationAudits).toEqual(
      expect.arrayContaining([
        {
          actorId: platformAdmin.id,
          action: "EMERGENCY_ACCESS_REVOKED_STAFF_AFFILIATION",
          resourceId: activeGrant.id,
        },
        {
          actorId: platformAdmin.id,
          action: "EMERGENCY_ACCESS_REVOKED_STAFF_AFFILIATION",
          resourceId: secondActiveGrant.id,
        },
      ]),
    );
    expect(initialRevocationAudits).toHaveLength(2);

    await db
      .update(facilityStaffAffiliations)
      .set({ status: "active", platformSuspended: false })
      .where(eq(facilityStaffAffiliations.id, affiliation.id));
    const oldGrantAfterReinstatement = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
        revokedAt: emergencyAccessRequests.revokedAt,
      })
      .from(emergencyAccessRequests)
      .where(eq(emergencyAccessRequests.id, activeGrant.id));
    expect(oldGrantAfterReinstatement[0]).toMatchObject({
      id: activeGrant.id,
      status: "revoked",
    });
    expect(oldGrantAfterReinstatement[0]?.revokedAt).toBeInstanceOf(Date);

    const reinstatedAt = new Date();
    const [newGrant] = await db
      .insert(emergencyAccessRequests)
      .values({
        patientId: patient.id,
        requesterUserId: staff.id,
        facilityId: facility.id,
        providerType: "hospital-emergency-department",
        reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
        status: "granted",
        grantedAt: reinstatedAt,
        expiresAt: new Date(reinstatedAt.getTime() + 30 * 60 * 1000),
      })
      .returning({ id: emergencyAccessRequests.id });
    if (!newGrant) throw new Error("Post-reinstatement grant was not created.");

    await service.updateStaffAffiliation(
      facility.id,
      affiliation.id,
      "revoke",
      platformAdmin,
      "127.0.0.1",
    );
    const revokedAfterRevoke = await db
      .select({
        id: emergencyAccessRequests.id,
        status: emergencyAccessRequests.status,
      })
      .from(emergencyAccessRequests)
      .where(
        inArray(emergencyAccessRequests.id, [
          activeGrant.id,
          secondActiveGrant.id,
          newGrant.id,
        ]),
      );
    expect(revokedAfterRevoke).toEqual(
      expect.arrayContaining([
        { id: activeGrant.id, status: "revoked" },
        { id: secondActiveGrant.id, status: "revoked" },
        { id: newGrant.id, status: "revoked" },
      ]),
    );
    const finalRevocationAudits = await db
      .select({ resourceId: auditEvents.resourceId })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.resourceId, [
            activeGrant.id,
            secondActiveGrant.id,
            newGrant.id,
          ]),
          eq(auditEvents.action, "EMERGENCY_ACCESS_REVOKED_STAFF_AFFILIATION"),
        ),
      );
    expect(finalRevocationAudits).toHaveLength(3);
  });
});
