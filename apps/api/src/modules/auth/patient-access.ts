import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../database/index.js";
import {
  accessRequests,
  consents,
  documents,
  guardianships,
  patientFacilityRelationships,
  patients,
  notifications,
} from "../../database/schema.js";

const guardianPatients = alias(patients, "guardian_patient");
const wardPatients = alias(patients, "ward_patient");

export interface PatientOwner {
  id: string;
  userId: string;
}

export async function findNotificationRecipient(
  notificationId: string
): Promise<string | undefined> {
  const [notification] = await db
    .select({ userId: notifications.recipientUserId })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  return notification?.userId;
}

export async function findPatientOwner(patientId: string): Promise<PatientOwner | undefined> {
  const [patient] = await db
    .select({ id: patients.id, userId: patients.userId })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);
  return patient;
}

export async function findPatientOwnerByUserId(
  userId: string
): Promise<PatientOwner | undefined> {
  const [patient] = await db
    .select({ id: patients.id, userId: patients.userId })
    .from(patients)
    .where(eq(patients.userId, userId))
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

export async function findDocumentAccessContext(
  documentId: string
): Promise<
  | {
      patient: PatientOwner;
      documentType: string;
    }
  | undefined
> {
  const [document] = await db
    .select({
      patientId: documents.patientId,
      documentType: documents.documentType,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) return undefined;

  const patient = await findPatientOwner(document.patientId);
  return patient ? { patient, documentType: document.documentType } : undefined;
}

export async function hasActiveConsentScope(
  patientId: string,
  clinicianUserId: string,
  scope: string
): Promise<boolean> {
  const [consent] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.patientId, patientId),
        eq(consents.granteeUserId, clinicianUserId),
        eq(consents.status, "active"),
        gt(consents.expiresAt, new Date()),
        or(
          sql`${consents.scope} @> ${JSON.stringify([scope])}::jsonb`,
          sql`${consents.scope} @> '["timeline"]'::jsonb`
        )
      )
    )
    .limit(1);
  return consent !== undefined;
}

export async function findActiveConsentRequestId(
  patientId: string,
  clinicianUserId: string,
  scope: string
): Promise<string | undefined> {
  const [consent] = await db
    .select({ requestId: consents.accessRequestId })
    .from(consents)
    .where(
      and(
        eq(consents.patientId, patientId),
        eq(consents.granteeUserId, clinicianUserId),
        eq(consents.status, "active"),
        gt(consents.expiresAt, new Date()),
        or(
          sql`${consents.scope} @> ${JSON.stringify([scope])}::jsonb`,
          sql`${consents.scope} @> '["timeline"]'::jsonb`
        )
      )
    )
    .limit(1);
  return consent?.requestId;
}

export interface ActiveRequestConsentContext {
  patientId: string;
  scope: string[];
  purpose: string;
  expiresAt: Date;
}

export async function findActiveRequestConsentContext(
  requestId: string,
  clinicianUserId: string
): Promise<ActiveRequestConsentContext | undefined> {
  const [context] = await db
    .select({
      patientId: accessRequests.patientId,
      scope: consents.scope,
      purpose: consents.purpose,
      expiresAt: consents.expiresAt,
    })
    .from(accessRequests)
    .innerJoin(consents, eq(consents.accessRequestId, accessRequests.id))
    .where(
      and(
        eq(accessRequests.id, requestId),
        eq(accessRequests.clinicianUserId, clinicianUserId),
        eq(accessRequests.status, "approved"),
        eq(consents.granteeUserId, clinicianUserId),
        eq(consents.status, "active"),
        gt(consents.expiresAt, new Date())
      )
    )
    .limit(1);
  return context;
}

export async function findAccessRequestPolicyContext(
  requestId: string
): Promise<
  | {
      patient: PatientOwner;
      clinicianUserId: string;
    }
  | undefined
> {
  const [context] = await db
    .select({
      patientId: accessRequests.patientId,
      patientUserId: patients.userId,
      clinicianUserId: accessRequests.clinicianUserId,
    })
    .from(accessRequests)
    .innerJoin(patients, eq(accessRequests.patientId, patients.id))
    .where(eq(accessRequests.id, requestId))
    .limit(1);

  return context
    ? {
        patient: { id: context.patientId, userId: context.patientUserId },
        clinicianUserId: context.clinicianUserId,
      }
    : undefined;
}

export async function findAccessRequestPatientOwner(
  requestId: string
): Promise<PatientOwner | undefined> {
  const [request] = await db
    .select({ patientId: accessRequests.patientId })
    .from(accessRequests)
    .where(eq(accessRequests.id, requestId))
    .limit(1);

  return request ? findPatientOwner(request.patientId) : undefined;
}

export async function findConsentResource(
  consentId: string
): Promise<
  | {
      patient: PatientOwner;
      granteeUserId: string;
      status: string;
      expiresAt: Date;
    }
  | undefined
> {
  const [consent] = await db
    .select({
      id: patients.id,
      userId: patients.userId,
      granteeUserId: consents.granteeUserId,
      status: consents.status,
      expiresAt: consents.expiresAt,
    })
    .from(consents)
    .innerJoin(patients, eq(consents.patientId, patients.id))
    .where(eq(consents.id, consentId))
    .limit(1);
  if (!consent) return undefined;

  return {
    patient: { id: consent.id, userId: consent.userId },
    granteeUserId: consent.granteeUserId,
    status: consent.status,
    expiresAt: consent.expiresAt,
  };
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

export async function findGuardianWardPatientIds(
  guardianUserId: string
): Promise<string[]> {
  const validAt = new Date();
  const wardRows = await db
    .select({ patientId: wardPatients.id })
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

  return [...new Set(wardRows.map(({ patientId }) => patientId))];
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
