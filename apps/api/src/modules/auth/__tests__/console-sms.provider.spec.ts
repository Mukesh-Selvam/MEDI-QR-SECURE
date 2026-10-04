import { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => ({ NODE_ENV: "development" as string }));
vi.mock("../../../config/env.js", () => ({ env: testEnv }));

import { ConsoleSmsProvider } from "../providers/console-sms.provider.js";

describe("ConsoleSmsProvider", () => {
  beforeEach(() => {
    testEnv.NODE_ENV = "development";
  });

  it("only exposes OTP values through the dev-only console provider", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    try {
      await new ConsoleSmsProvider().sendOtp("+919876543210", "123456");
      expect(logSpy).toHaveBeenCalledWith("[CONSOLE-SMS] OTP for +919876543210: 123456");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("cannot be constructed in production", () => {
    testEnv.NODE_ENV = "production";
    expect(() => new ConsoleSmsProvider()).toThrow(
      "ConsoleSmsProvider is strictly forbidden in production."
    );
  });
});
