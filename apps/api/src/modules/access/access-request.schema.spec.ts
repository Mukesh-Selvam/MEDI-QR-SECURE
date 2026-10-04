import { describe, expect, it } from "vitest";
import { createAccessRequestSchema } from "./access-request.schema.js";

describe("createAccessRequestSchema", () => {
  const valid = {
    resolutionId: "8c370d16-6f99-4d1f-8e33-28345432001b",
    purpose: "clinical-care",
    scope: ["timeline", "document:lab"],
  };

  it("accepts a bounded purpose and requested scope", () => {
    expect(createAccessRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty, duplicate, or unsupported scopes", () => {
    expect(
      createAccessRequestSchema.safeParse({ ...valid, scope: [] }).success
    ).toBe(false);
    expect(
      createAccessRequestSchema.safeParse({
        ...valid,
        scope: ["timeline", "timeline"],
      }).success
    ).toBe(false);
    expect(
      createAccessRequestSchema.safeParse({
        ...valid,
        scope: ["medical-records"],
      }).success
    ).toBe(false);
  });

  it("rejects client-supplied patient or clinician identifiers", () => {
    expect(
      createAccessRequestSchema.safeParse({
        ...valid,
        patientId: "8c370d16-6f99-4d1f-8e33-28345432001b",
      }).success
    ).toBe(false);
  });
});
