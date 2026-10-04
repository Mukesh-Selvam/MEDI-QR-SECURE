import { and, eq, gt, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../database/index.js";
import {
  documents,
  guardianships,
  patientFacilityRelationships,
  patients,
} from "../../database/schema.js";

const guardianPatients = alias(patients, "guardian_patient");
const wardPatients = alias(patients, "ward_patient");

export interface PatientOwner {
  id: string;
  userId: string;
}

export async function findPatientOwner(patientId: string): Promise<PatientOwner | undefined> {
  const [patient] = await db
    .select({ id: patients.id, userId: patients.userId })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);
  return patient;
}

export async function findDocumentPatientOwner(
  documentId: string
): Promise<PatientOwner | undefined> {
  const [document] = await db
    .select({ patientId: documents.patientId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return document ? findPatientOwner(document.patientId) : undefined;
}

export async function findGuardianWardOwnerIds(guardianUserId: string): Promise<string[]> {
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

export async function isVerifiedGuardianOfPatient(
  guardianUserId: string,
  wardPatientId: string
): Promise<boolean> {
  const [relationship] = await db
    .select({ id: guardianships.id })
    .from(guardianships)
    .innerJoin(
      guardianPatients,
      eq(guardianships.guardianPatientId, guardianPatients.id)
    )
    .where(
      and(
        eq(guardianPatients.userId, guardianUserId),
        eq(guardianships.wardPatientId, wardPatientId),
        eq(guardianships.verificationStatus, "verified"),
        or(isNull(guardianships.validUntil), gt(guardianships.validUntil, new Date()))
      )
    )
    .limit(1);

  return relationship !== undefined;
}

export async function hasActiveFacilityPatientRelationship(
  facilityId: string,
  patientId: string
): Promise<boolean> {
  const [relationship] = await db
    .select({ id: patientFacilityRelationships.id })
    .from(patientFacilityRelationships)
    .where(
      and(
        eq(patientFacilityRelationships.facilityId, facilityId),
        eq(patientFacilityRelationships.patientId, patientId),
        eq(patientFacilityRelationships.isActive, true),
        isNull(patientFacilityRelationships.revokedAt),
        or(
          isNull(patientFacilityRelationships.validUntil),
          gt(patientFacilityRelationships.validUntil, new Date())
        )
      )
    )
    .limit(1);

  return relationship !== undefined;
}
