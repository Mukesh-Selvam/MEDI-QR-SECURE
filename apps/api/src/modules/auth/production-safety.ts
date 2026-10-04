/**
 * Production Safety Validator (Condition 8)
 *
 * Invariant: Any dev shortcut (fixed OTP, console OTP adapter, mock provider, bypass)
 * must be impossible to enable when NODE_ENV=production, enforced by a startup
 * check that refuses to boot.
 */
export interface AuthSafetyCheckOptions {
  nodeEnv: string;
  smsProviderClassName: string;
  fixedOtp?: string | undefined;
  bypassAuth?: boolean | string | undefined;
}

export function assertProductionAuthSafety(options: AuthSafetyCheckOptions): void {
  const isProduction = options.nodeEnv === "production";
  if (!isProduction) return;

  const disallowedProviders = new Set([
    "ConsoleSmsProvider",
    "MailpitSmsProvider",
    "MockSmsProvider",
  ]);

  if (disallowedProviders.has(options.smsProviderClassName)) {
    throw new Error(
      `[SECURITY INVARIANT VIOLATION] Dev SMS provider '${options.smsProviderClassName}' ` +
        `is strictly forbidden in production! A real production SMS provider is required.`
    );
  }

  if (options.fixedOtp && options.fixedOtp.trim().length > 0) {
    throw new Error(
      `[SECURITY INVARIANT VIOLATION] Fixed/hardcoded OTP shortcuts are strictly forbidden in production!`
    );
  }

  if (
    options.bypassAuth === true ||
    options.bypassAuth === "true" ||
    options.bypassAuth === "1"
  ) {
    throw new Error(
      `[SECURITY INVARIANT VIOLATION] Authentication bypass flags are strictly forbidden in production!`
    );
  }
}
