import { z } from "zod";

export const updateEmergencyDocumentVisibilitySchema = z
  .object({
    emergencyVisible: z.boolean(),
  })
  .strict();

export type UpdateEmergencyDocumentVisibilityInput = z.infer<
  typeof updateEmergencyDocumentVisibilitySchema
>;
