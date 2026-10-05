import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../../database/index.js";
import { guardianships, patients, users } from "../../../database/schema.js";
import {
  findGuardianWardOwnerIds,
  findPatientOwner
} from "../patient-access.js";

describe("Emergency-profile Cerbos owner identifiers (integration)", () => {
  const suffix = randomUUID();
  let guardianUserId: string | undefined;
  let wardUserId: string | undefined;
  let guardianPatientId: string | undefined;
  let wardPatientId: string | undefined;
  let guardianshipId: string | undefined;

  beforeAll(async () => {
    const [guardianUser] = await db
      .insert(users)
      .values({ role: "guardian", status: "active" })
      .returning({ id: users.id });
    const [wardUser] = await db
      .insert(users)
      .values({ role: "patient", status: "active" })
      .returning({ id: users.id });
    guardianUserId = guardianUser?.id;
    wardUserId = wardUser?.id;
    if (!guardianUserId || !wardUserId) {
      throw new Error("Could not create integration-test users.");
    }

    const [guardianPatient] = await db
      .insert(patients)
      .values({
        userId: guardianUserId,
        healthId: `TEST-GUARDIAN-${suffix}`,
        fullName: "FAKE Guardian",
        phoneHash: "1".repeat(64),
        encryptedPhone: "integration-test-ciphertext"
      })
      .returning({ id: patients.id });
    const [wardPatient] = await db
      .insert(patients)
      .values({
        userId: wardUserId,
        healthId: `TEST-WARD-${suffix}`,
        fullName: "FAKE Ward",
        phoneHash: "2".repeat(64),
        encryptedPhone: "integration-test-ciphertext"
      })
      .returning({ id: patients.id });
    guardianPatientId = guardianPatient?.id;
    wardPatientId = wardPatient?.id;
    if (!guardianPatientId || !wardPatientId) {
      throw new Error("Could not create integration-test patient profiles.");
    }

    const [guardianship] = await db
      .insert(guardianships)
      .values({
        guardianPatientId,
        wardPatientId,
        relationship: "legal_guardian",
        verificationStatus: "verified"
      })
      .returning({ id: guardianships.id });
    guardianshipId = guardianship?.id;
    if (!guardianshipId) {
      throw new Error("Could not create an integration-test guardianship.");
    }
  });

  afterAll(async () => {
    if (guardianshipId) {
      await db
        .delete(guardianships)
        .where(eq(guardianships.id, guardianshipId));
    }
    if (guardianPatientId) {
      await db.delete(patients).where(eq(patients.id, guardianPatientId));
    }
    if (wardPatientId) {
      await db.delete(patients).where(eq(patients.id, wardPatientId));
    }
    if (guardianUserId) {
      await db.delete(users).where(eq(users.id, guardianUserId));
    }
    if (wardUserId) {
      await db.delete(users).where(eq(users.id, wardUserId));
    }
  });

  it("uses user UUIDs for both resource owner_id and guardian_ward_ids", async () => {
    if (!guardianUserId || !wardUserId || !wardPatientId) {
      throw new Error("Integration-test fixtures were not created.");
    }

    const owner = await findPatientOwner(wardPatientId);
    const guardianWardIds = await findGuardianWardOwnerIds(guardianUserId);
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(owner?.id).toMatch(uuidPattern);
    expect(owner?.userId).toBe(wardUserId);
    expect(owner?.userId).toMatch(uuidPattern);
    expect(guardianUserId).toMatch(uuidPattern);
    expect(guardianWardIds).toContain(owner?.userId);
    expect(guardianWardIds.every((id) => uuidPattern.test(id))).toBe(true);
  });
});
