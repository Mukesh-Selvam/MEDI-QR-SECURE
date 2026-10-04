/**
 * ConsoleSmsProvider — logs OTP to stdout. Used in CI / unit tests.
 */
import { Logger } from "@nestjs/common";
import type { SmsProvider } from "./sms-provider.interface.js";
import { env } from "../../../config/env.js";

export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  constructor() {
    if (env.NODE_ENV === "production") {
      throw new Error("ConsoleSmsProvider is strictly forbidden in production.");
    }
  }

  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.log(`[CONSOLE-SMS] OTP for ${phone}: ${otp}`);
  }
}
