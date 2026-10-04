import { z } from "zod";

export const accessPurposeValues = [
  "clinical-care",
  "medication-review",
  "vaccination-follow-up",
  "continuity-of-care",
] as const;

export const accessScopeValues = [
  "timeline",
  "document:scan",
  "document:lab",
  "document:prescription",
  "document:vaccination",
  "document:discharge",
] as const;

export const createAccessRequestSchema = z
  .object({
    resolutionId: z.string().uuid(),
    purpose: z.enum(accessPurposeValues),
    scope: z.array(z.enum(accessScopeValues)).min(1).max(accessScopeValues.length),
  })
  .strict()
  .refine(({ scope }) => new Set(scope).size === scope.length, {
    path: ["scope"],
    message: "Scope entries must be unique",
  });

export type CreateAccessRequestInput = z.infer<
  typeof createAccessRequestSchema
>;
export type AccessScope = (typeof accessScopeValues)[number];
