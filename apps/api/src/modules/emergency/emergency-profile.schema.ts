import { z } from "zod";

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(64),
    phone: z.string().trim().min(5).max(32),
  })
  .strict();

export const emergencyProfileSchema = z
  .object({
    bloodGroup: z.enum([
      "",
      "A+",
      "A-",
      "B+",
      "B-",
      "AB+",
      "AB-",
      "O+",
      "O-",
      "unknown",
    ]),
    allergies: z.array(z.string().trim().min(1).max(160)).max(30),
    emergencyContacts: z.array(contactSchema).max(5),
    enabled: z.boolean(),
  })
  .strict();

export type EmergencyProfileInput = z.infer<typeof emergencyProfileSchema>;
