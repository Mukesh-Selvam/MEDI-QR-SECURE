import { describe, expect, it } from "vitest";
import { createEmergencyAccessRequestSchema } from "./emergency-access.schema.js";

describe("createEmergencyAccessRequestSchema", () => {
  const validRequest = {
    resolutionId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    reasonCode: "TIME_CRITICAL_EMERGENCY_CARE",
  };

  it("accepts only the approved finite reason-code list", () => {
    expect(createEmergencyAccessRequestSchema.safeParse(validRequest).success).toBe(
      true,
    );
    expect(
      createEmergencyAccessRequestSchema.safeParse({
        ...validRequest,
        reasonCode: "SOMETHING_ELSE",
      }).success,
    ).toBe(false);
  });

  it("rejects free-text notes and unexpected request fields", () => {
    expect(
      createEmergencyAccessRequestSchema.safeParse({
        ...validRequest,
        reason: "free text is not permitted",
      }).success,
    ).toBe(false);
  });
});
