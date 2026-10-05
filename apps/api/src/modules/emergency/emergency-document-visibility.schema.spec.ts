import { describe, expect, it } from "vitest";
import { updateEmergencyDocumentVisibilitySchema } from "./emergency-document-visibility.schema.js";

describe("updateEmergencyDocumentVisibilitySchema", () => {
  it("accepts a boolean opt-in value", () => {
    expect(
      updateEmergencyDocumentVisibilitySchema.parse({
        emergencyVisible: true,
      }),
    ).toEqual({ emergencyVisible: true });
  });

  it("rejects string values and unknown fields", () => {
    expect(
      updateEmergencyDocumentVisibilitySchema.safeParse({
        emergencyVisible: "true",
      }).success,
    ).toBe(false);
    expect(
      updateEmergencyDocumentVisibilitySchema.safeParse({
        emergencyVisible: true,
        note: "free text is not allowed",
      }).success,
    ).toBe(false);
  });
});
