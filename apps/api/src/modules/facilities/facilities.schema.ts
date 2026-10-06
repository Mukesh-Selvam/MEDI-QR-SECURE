import { z } from "zod";
import { facilityTypeEnum } from "../../database/schema.js";

export const createFacilitySchema = z
  .object({
    facilityType: z.enum(facilityTypeEnum.enumValues),
    displayName: z.string().trim().min(1).max(255),
    registrationNumber: z.string().trim().min(1).max(128),
    registrationJurisdiction: z.string().trim().min(1).max(128),
  })
  .strict();

export const facilityVerificationSchema = z
  .object({
    status: z.enum(["verified", "rejected", "suspended", "revoked"]),
  })
  .strict();

export const affiliationUserSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

export const acceptStaffInvitationSchema = z
  .object({
    invitationToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export const resourceIdSchema = z.string().uuid();
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type FacilityVerificationInput = z.infer<
  typeof facilityVerificationSchema
>;
