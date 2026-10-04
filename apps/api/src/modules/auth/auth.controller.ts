/**
 * AuthController — Public OTP endpoints + authenticated session management.
 *
 * POST /api/v1/auth/otp/send     — Request OTP (public)
 * POST /api/v1/auth/otp/verify   — Verify OTP, issue cookies (public)
 * POST /api/v1/auth/refresh      — Rotate refresh token (public, uses cookie)
 * POST /api/v1/auth/logout       — Revoke current session
 * POST /api/v1/auth/logout/all   — Revoke all sessions
 * GET  /api/v1/auth/me           — Return current user info
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac } from "crypto";
import { AuthService } from "./auth.service.js";
import { PublicRoute } from "./decorators/public.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "./decorators/current-user.decorator.js";
import { RequirePolicy } from "./decorators/policy.decorator.js";
import { env } from "../../config/env.js";

function hashIp(ip: string): string {
  return createHmac("sha256", env.AUDIT_HMAC_KEY).update(ip).digest("hex");
}

class SendOtpDto {
  phone!: string;
}

class VerifyOtpDto {
  phone!: string;
  otp!: string;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @PublicRoute()
  @Post("otp/send")
  @HttpCode(HttpStatus.OK)
  async sendOtp(
    @Body() body: SendOtpDto,
    @Req() req: FastifyRequest
  ): Promise<{ message: string }> {
    const ip = req.ip ?? "unknown";
    return this.authService.sendOtp(body.phone, hashIp(ip));
  }

  @PublicRoute()
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ message: string; csrfToken: string }> {
    const ip = req.ip ?? "unknown";
    const ua = req.headers["user-agent"] ?? "unknown";
    return this.authService.verifyOtp(
      body.phone,
      body.otp,
      hashIp(ip),
      ua,
      reply
    );
  }

  @PublicRoute()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ message: string; csrfToken: string }> {
    const ip = req.ip ?? "unknown";
    const ua = req.headers["user-agent"] ?? "unknown";
    const refreshToken = (req.cookies as Record<string, string | undefined>)[
      "__Host-mediqr-refresh"
    ];
    return this.authService.refreshSession(
      refreshToken,
      hashIp(ip),
      ua,
      reply
    );
  }

  @RequirePolicy({ resource: "auth", action: "logout" })
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ message: string }> {
    const ip = req.ip ?? "unknown";
    const refreshToken = (req.cookies as Record<string, string | undefined>)[
      "__Host-mediqr-refresh"
    ];
    return this.authService.logout(user, refreshToken, hashIp(ip), reply);
  }

  @RequirePolicy({ resource: "auth", action: "logout" })
  @Post("logout/all")
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ message: string }> {
    return this.authService.logoutEverywhere(
      user,
      hashIp(req.ip ?? "unknown"),
      reply
    );
  }

  @RequirePolicy({ resource: "auth", action: "read" })
  @Get("me")
  me(
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AuthenticatedUser & { patientId: string | null }> {
    return this.authService.getCurrentUserProfile(user);
  }
}
