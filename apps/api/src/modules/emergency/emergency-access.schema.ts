import { z } from "zod";

export const emergencyReasonCodes = [
  "PATIENT_UNABLE_TO_CONSENT",
  "GUARDIAN_UNAVAILABLE",
  "TIME_CRITICAL_EMERGENCY_CARE",
  "OTHER_EMERGENCY_CIRCUMSTANCE",
] as const;

export const createEmergencyAccessRequestSchema = z
  .object({
    resolutionId: z.string().uuid(),
    reasonCode: z.enum(emergencyReasonCodes),
  })
  .strict();

export type CreateEmergencyAccessRequestInput = z.infer<
  typeof createEmergencyAccessRequestSchema
>;
