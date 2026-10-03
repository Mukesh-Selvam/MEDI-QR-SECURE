import { z } from "zod";

/**
 * MediQR FHIR R4 Profiles
 * Assistive representation complying with HL7 FHIR R4 standards
 * strictly for interoperability with ABDM / NRCeS India profiles.
 */

export const FHIRIdentifierSchema = z.object({
  system: z.string().url(),
  value: z.string(),
});

export const FHIRCodingSchema = z.object({
  system: z.string().url().optional(),
  code: z.string(),
  display: z.string(),
});

export const FHIRCodeableConceptSchema = z.object({
  coding: z.array(FHIRCodingSchema),
});

export const FHIRReferenceSchema = z.object({
  reference: z.string(),
  display: z.string().optional(),
});

export const FHIRPatientResourceSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string(),
  identifier: z.array(FHIRIdentifierSchema),
  active: z.boolean(),
  gender: z.enum(["male", "female", "other", "unknown"]),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  managingOrganization: FHIRReferenceSchema.optional(),
});
export type FHIRPatientResource = z.infer<typeof FHIRPatientResourceSchema>;

export const FHIRDocumentReferenceAttachmentSchema = z.object({
  contentType: z.string(),
  url: z.string().optional(),
  hash: z.string().optional(),
  title: z.string(),
});

export const FHIRDocumentReferenceContentSchema = z.object({
  attachment: FHIRDocumentReferenceAttachmentSchema,
});

export const FHIRDocumentReferenceResourceSchema = z.object({
  resourceType: z.literal("DocumentReference"),
  id: z.string(),
  status: z.enum(["current", "superseded", "entered-in-error"]),
  docStatus: z.enum(["preliminary", "final", "amended"]).optional(),
  type: FHIRCodeableConceptSchema,
  category: z.array(FHIRCodeableConceptSchema).optional(),
  subject: FHIRReferenceSchema,
  date: z.string().datetime(),
  author: z.array(FHIRReferenceSchema).optional(),
  content: z.array(FHIRDocumentReferenceContentSchema),
});
export type FHIRDocumentReferenceResource = z.infer<
  typeof FHIRDocumentReferenceResourceSchema
>;
