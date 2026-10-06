import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Reflector } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { PolicyGuard } from "./guards/policy.guard.js";
import { CsrfGuard } from "./guards/csrf.guard.js";
import { AuditModule } from "../audit/audit.module.js";
import { SMS_PROVIDER } from "./providers/sms-provider.interface.js";
import { MailpitSmsProvider } from "./providers/mailpit-sms.provider.js";
import { assertProductionAuthSafety } from "./production-safety.js";
import { env } from "../../config/env.js";

// Startup check refuses to boot if any dev shortcut is enabled in production (Condition 8)
assertProductionAuthSafety({
  nodeEnv: env.NODE_ENV,
  smsProviderClassName: MailpitSmsProvider.name,
  fixedOtp: process.env.DEV_FIXED_OTP,
  bypassAuth: process.env.BYPASS_AUTH,
  e2eOtpResetEnabled: env.NODE_ENV === "test",
});

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    // Reflector is needed by guards registered via APP_GUARD
    Reflector,

    // SMS provider
    { provide: SMS_PROVIDER, useClass: MailpitSmsProvider },

    // AuthService uses constructor injection
    AuthService,

    // Global guards — applied in order: JWT -> CSRF -> Policy
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PolicyGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
