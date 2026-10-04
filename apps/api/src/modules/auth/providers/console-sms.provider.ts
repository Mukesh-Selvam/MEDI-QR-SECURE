/**
 * ConsoleSmsProvider — logs OTP to stdout. Used in CI / unit tests.
 */
import type { SmsProvider } from "./sms-provider.interface.js";

export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, otp: string): Promise<void> {
    console.log(`[CONSOLE-SMS] OTP for ${phone}: ${otp}`);
  }
}
