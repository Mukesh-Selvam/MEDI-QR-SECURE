import { describe, expect, it } from "vitest";
import { emergencyProfileSchema } from "./emergency-profile.schema.js";

describe("emergency profile validation", () => {
  it("accepts patient-declared fields and an explicit opt-in state", () => {
    expect(
      emergencyProfileSchema.safeParse({
        bloodGroup: "B+",
        allergies: ["FAKE pollen sensitivity"],
        emergencyContacts: [
          {
            name: "FAKE Contact",
            relationship: "guardian",
            phone: "+910000000000",
          },
        ],
        enabled: true,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed or excessive declared data", () => {
    expect(
      emergencyProfileSchema.safeParse({
        bloodGroup: "invalid",
        allergies: [],
        emergencyContacts: [],
        enabled: false,
      }).success,
    ).toBe(false);
    expect(
      emergencyProfileSchema.safeParse({
        bloodGroup: "unknown",
        allergies: Array.from({ length: 31 }, () => "FAKE allergy"),
        emergencyContacts: [],
        enabled: false,
      }).success,
    ).toBe(false);
  });
});
