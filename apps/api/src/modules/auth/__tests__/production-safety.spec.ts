import { describe, it, expect } from "vitest";
import { assertProductionAuthSafety } from "../production-safety.js";

describe("Production Safety Validator (Condition 8)", () => {
  it("allows development SMS providers when NODE_ENV is development or test", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "development",
        smsProviderClassName: "MailpitSmsProvider",
      })
    ).not.toThrow();

    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "test",
        smsProviderClassName: "ConsoleSmsProvider",
      })
    ).not.toThrow();
  });

  it("refuses to boot in production with MailpitSmsProvider", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "MailpitSmsProvider",
      })
    ).toThrowError(/strictly forbidden in production/i);
  });

  it("refuses to boot in production with ConsoleSmsProvider", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "ConsoleSmsProvider",
      })
    ).toThrowError(/strictly forbidden in production/i);
  });

  it("refuses to boot in production when a fixed OTP is provided", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "ProductionGupshupSmsProvider",
        fixedOtp: "123456",
      })
    ).toThrowError(/Fixed\/hardcoded OTP shortcuts are strictly forbidden in production/i);
  });

  it("refuses to boot in production when BYPASS_AUTH is set", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "ProductionGupshupSmsProvider",
        bypassAuth: "true",
      })
    ).toThrowError(/Authentication bypass flags are strictly forbidden in production/i);
  });

  it("refuses to boot in production when E2E OTP rate-limit reset is enabled", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "ProductionGupshupSmsProvider",
        e2eOtpResetEnabled: true,
      })
    ).toThrowError(/E2E OTP rate-limit reset is strictly forbidden in production/i);
  });

  it("permits production boot with valid production SMS provider and no shortcuts", () => {
    expect(() =>
      assertProductionAuthSafety({
        nodeEnv: "production",
        smsProviderClassName: "ProductionGupshupSmsProvider",
      })
    ).not.toThrow();
  });
});
