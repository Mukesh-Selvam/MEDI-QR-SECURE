import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { POLICY_KEY } from "../auth/decorators/policy.decorator.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { EmergencyProfileController } from "./emergency-profile.controller.js";

describe("EmergencyProfileController policy declarations", () => {
  it("routes reads and updates through JWT auth and the same patient-owner policy guard", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, EmergencyProfileController)
    ).toEqual([JwtAuthGuard, PolicyGuard]);

    const handlers = [
      {
        handler: EmergencyProfileController.prototype.read,
        action: "read"
      },
      {
        handler: EmergencyProfileController.prototype.update,
        action: "update"
      }
    ];

    for (const { handler, action } of handlers) {
      expect(Reflect.getMetadata(POLICY_KEY, handler)).toEqual({
        resource: "emergency-profile",
        action
      });
      expect(Reflect.getMetadata("path", handler)).toBe(":patientId");
    }
  });
});
