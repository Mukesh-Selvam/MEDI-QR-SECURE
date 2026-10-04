/**
 * MailpitSmsProvider — sends OTP as an email via Mailpit SMTP in dev.
 * In production, replace with GupshupSmsProvider or TwilioSmsProvider.
 */
import type { SmsProvider } from "./sms-provider.interface.js";
import { createTransport } from "nodemailer";
import { env } from "../../../config/env.js";

export class MailpitSmsProvider implements SmsProvider {
  private readonly transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
  });

  async sendOtp(phone: string, otp: string): Promise<void> {
    await this.transport.sendMail({
      from: "MediQR <noreply@mediqr.local>",
      to: `otp-dev@mediqr.local`,
      subject: `MediQR OTP for ${phone}`,
      text: [
        `Your MediQR one-time password is: ${otp}`,
        `Valid for 3 minutes. Do not share it with anyone.`,
        `Phone: ${phone}`,
      ].join("\n"),
    });
  }
}
