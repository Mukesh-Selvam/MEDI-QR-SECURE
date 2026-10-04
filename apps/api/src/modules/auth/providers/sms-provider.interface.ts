/**
 * SmsProvider — abstraction for OTP delivery.
 * Dev: MailpitSmsProvider (email via Mailpit).
 * Prod: Plug in GupshupSmsProvider / TwilioSmsProvider.
 */
export interface SmsProvider {
  sendOtp(phone: string, otp: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
