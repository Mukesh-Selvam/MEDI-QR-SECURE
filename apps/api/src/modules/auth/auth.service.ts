/**
 * AuthService — Patient Mobile-OTP flow & session management.
 *
 * Security invariants:
 * - OTP is 6 digits, cryptographically random (crypto.randomInt).
 * - Only the SHA-256 hash of the OTP is stored in Redis (single-use).
 * - Rate limits: 3 sends/phone/10 min, 5 verifies/phone before 15 min lockout,
 *   10 sends/IP/hour.
 * - Refresh tokens stored as SHA-256 hash only (sessions table).
 * - Tokens set in HttpOnly SameSite=Strict Secure __Host- cookies.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  UnauthorizedException
} from "@nestjs/common";
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual
} from "crypto";
import type { FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { createRedisClient } from "../../config/redis.config.js";
import { db } from "../../database/index.js";
import { patients, sessions, users } from "../../database/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";
import type { SmsProvider } from "./providers/sms-provider.interface.js";
import { SMS_PROVIDER } from "./providers/sms-provider.interface.js";
import { AuditService } from "../audit/audit.service.js";
import { env } from "../../config/env.js";
import type { AuthenticatedUser } from "./decorators/current-user.decorator.js";
import { SignJWT } from "jose";

// Cookie names (using __Host- prefix for max security)
const ACCESS_COOKIE = "__Host-mediqr-access";
const REFRESH_COOKIE = "__Host-mediqr-refresh";
const CSRF_COOKIE = "__Host-mediqr-csrf";

// Redis key helpers
const otpKey = (phone: string) => `otp:hmac:${sha256(phone)}`;
const otpAttemptsKey = (phone: string) => `otp:attempts:${sha256(phone)}`;
const otpSendKey = (phone: string) => `otp:send:${sha256(phone)}`;
const otpIpKey = (ip: string) => `otp:ip:${ip}`;

// Escalating lockout keys:
const otpLockoutPhoneKey = (phone: string) =>
  `otp:lockout:phone:${sha256(phone)}`;
const otpLockoutIpKey = (ipHash: string) => `otp:lockout:ip:${ipHash}`;
const otpViolationsPhoneKey = (phone: string) =>
  `otp:violations:phone:${sha256(phone)}`;
const otpViolationsIpKey = (ipHash: string) => `otp:violations:ip:${ipHash}`;

function sha256(val: string): string {
  return createHash("sha256").update(val).digest("hex");
}

function hashPatientPhone(phone: string): string {
  const blindIndexKey = createHmac(
    "sha256",
    Buffer.from(env.MASTER_ENCRYPTION_KEY, "hex")
  )
    .update("mediqr:patient-phone-blind-index-key:v1")
    .digest();
  try {
    return createHmac("sha256", blindIndexKey).update(phone).digest("hex");
  } finally {
    blindIndexKey.fill(0);
  }
}

function encryptPatientPhone(phone: string): string {
  const iv = randomBytes(12);
  const plaintext = Buffer.from(phone, "utf8");
  try {
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(env.MASTER_ENCRYPTION_KEY, "hex"),
      iv
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);
    return JSON.stringify({
      version: 1,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    });
  } finally {
    plaintext.fill(0);
  }
}

function hmacOtp(otp: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(otp).digest("hex");
}

function phoneIsValid(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly redis: Redis;

  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {
    this.redis = createRedisClient();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async resetE2eIpOtpRateLimits(ipHash: string): Promise<void> {
    await this.redis.del(
      otpIpKey(ipHash),
      otpLockoutIpKey(ipHash),
      otpViolationsIpKey(ipHash)
    );
  }

  // ---------------------------------------------------------------------------
  // Escalating Lockout Helpers
  // ---------------------------------------------------------------------------
  private async applyEscalatingLockout(
    type: "phone" | "ip",
    identifier: string
  ): Promise<number> {
    const violationKey =
      type === "phone"
        ? otpViolationsPhoneKey(identifier)
        : otpViolationsIpKey(identifier);
    const lockoutKey =
      type === "phone"
        ? otpLockoutPhoneKey(identifier)
        : otpLockoutIpKey(identifier);

    const violations = await this.redis.incr(violationKey);
    if (violations === 1) {
      await this.redis.expire(violationKey, 86400); // 24 hour rolling violation window
    }

    // Level 1: 15 min (900s), Level 2: 1 hour (3600s), Level 3+: 24 hours (86400s)
    let lockSeconds = 900;
    if (violations === 2) lockSeconds = 3600;
    else if (violations >= 3) lockSeconds = 86400;

    await this.redis.set(lockoutKey, String(violations), "EX", lockSeconds);
    return lockSeconds;
  }

  private async checkLockout(phone: string, ipHash: string): Promise<void> {
    const ipLocked = await this.redis.ttl(otpLockoutIpKey(ipHash));
    if (ipLocked > 0) {
      throw new HttpException(
        `Too many requests from this IP. Temporarily locked for ${Math.ceil(ipLocked / 60)} more minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const phoneLocked = await this.redis.ttl(otpLockoutPhoneKey(phone));
    if (phoneLocked > 0) {
      throw new HttpException(
        `Too many requests for this phone number. Account temporarily locked for ${Math.ceil(phoneLocked / 60)} more minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  // ---------------------------------------------------------------------------
  // OTP: Send (Condition 1, 2, 3)
  // ---------------------------------------------------------------------------
  async sendOtp(
    phone: string,
    ipHash: string,
    requestId: string
  ): Promise<{ message: string }> {
    if (!phoneIsValid(phone)) {
      throw new BadRequestException(
        "Phone must be in +91XXXXXXXXXX format (Indian mobile number)"
      );
    }

    // 1. Check active escalating lockouts
    await this.checkLockout(phone, ipHash);

    // 2. Rate limit: 10 per IP per hour with escalating lockout
    const ipCount = await this.redis.incr(otpIpKey(ipHash));
    if (ipCount === 1) await this.redis.expire(otpIpKey(ipHash), 3600);
    if (ipCount > 10) {
      const lockSec = await this.applyEscalatingLockout("ip", ipHash);
      await this.auditService.log({
        action: "AUTH_OTP_RATE_LIMITED",
        resourceType: "auth",
        resourceId: "otp",
        outcome: "DENIED",
        ipHash
      });
      throw new HttpException(
        `Too many OTP requests from this IP. Temporarily locked for ${Math.ceil(lockSec / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // 3. Rate limit: 3 per phone per 10 minutes with escalating lockout
    const phoneCount = await this.redis.incr(otpSendKey(phone));
    if (phoneCount === 1) await this.redis.expire(otpSendKey(phone), 600);
    if (phoneCount > 3) {
      const lockSec = await this.applyEscalatingLockout("phone", phone);
      await this.auditService.log({
        action: "AUTH_OTP_RATE_LIMITED",
        resourceType: "auth",
        resourceId: "otp",
        outcome: "DENIED",
        ipHash
      });
      throw new HttpException(
        `Too many OTP requests for this number. Temporarily locked for ${Math.ceil(lockSec / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // 4. Invalidate any old codes and reset attempts when a new code is issued
    await this.redis.del(otpKey(phone));
    await this.redis.del(otpAttemptsKey(phone));

    // 5. Generate secure 6-digit OTP & store ONLY server-secret HMAC with 5-minute TTL (300s)
    const otp = String(randomInt(100000, 999999));
    const hmac = hmacOtp(otp);
    await this.redis.set(otpKey(phone), hmac, "EX", 300);

    // 6. Dispatch via SMS provider
    await this.smsProvider.sendOtp(phone, otp);
    this.logger.log(`OTP dispatched for request ${requestId}`);

    // 7. Audit log with zero plaintext phone/OTP
    await this.auditService.log({
      action: "AUTH_OTP_SEND",
      resourceType: "auth",
      resourceId: "otp",
      outcome: "SUCCESS",
      ipHash
    });

    // Identical response whether account existed or not
    return { message: "OTP sent. Valid for 5 minutes." };
  }

  // ---------------------------------------------------------------------------
  // OTP: Verify & Issue Session (Condition 1, 2, 4, 7)
  // ---------------------------------------------------------------------------
  async verifyOtp(
    phone: string,
    otp: string,
    ipHash: string,
    userAgent: string,
    reply: FastifyReply
  ): Promise<{ message: string; csrfToken: string }> {
    if (!phoneIsValid(phone)) {
      throw new BadRequestException("Invalid phone number format");
    }

    // 1. Check active escalating lockouts
    await this.checkLockout(phone, ipHash);

    // 2. Check failed attempts on current code (max 5 attempts)
    const currentAttempts = await this.redis.get(otpAttemptsKey(phone));
    if (currentAttempts && parseInt(currentAttempts, 10) >= 5) {
      await this.redis.del(otpKey(phone));
      const lockSec = await this.applyEscalatingLockout("phone", phone);
      throw new HttpException(
        `Maximum verification attempts exceeded. Account temporarily locked for ${Math.ceil(lockSec / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // 3. Retrieve stored HMAC
    const storedHmac = await this.redis.get(otpKey(phone));
    if (!storedHmac) {
      throw new BadRequestException("OTP expired or not requested");
    }

    // 4. Constant-time HMAC comparison
    const providedHmac = hmacOtp(otp);
    const isMatch =
      providedHmac.length === storedHmac.length &&
      timingSafeEqual(
        Buffer.from(providedHmac, "hex"),
        Buffer.from(storedHmac, "hex")
      );

    if (!isMatch) {
      const newAttempts = await this.redis.incr(otpAttemptsKey(phone));
      if (newAttempts === 1) {
        await this.redis.expire(otpAttemptsKey(phone), 300);
      }

      await this.auditService.log({
        action: "AUTH_OTP_VERIFY_FAIL",
        resourceType: "auth",
        resourceId: "otp",
        outcome: "FAILURE",
        ipHash
      });

      if (newAttempts >= 5) {
        // Invalidate code and trigger escalating lockout
        await this.redis.del(otpKey(phone));
        await this.redis.del(otpAttemptsKey(phone));
        const lockSec = await this.applyEscalatingLockout("phone", phone);
        throw new HttpException(
          `Maximum verification attempts exceeded. Code invalidated. Account locked for ${Math.ceil(lockSec / 60)} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      throw new BadRequestException(
        `Invalid OTP (${5 - newAttempts} attempts remaining)`
      );
    }

    // 5. Single-use: delete OTP and attempts immediately after successful verification
    await this.redis.del(otpKey(phone));
    await this.redis.del(otpAttemptsKey(phone));

    // 6. Provision or resolve patient record (identical response/timing invariant)
    const { resolvedUser, patientCreated } = await db.transaction(
      async (transaction) => {
        let [user] = await transaction
          .select()
          .from(users)
          .where(eq(users.phone, phone))
          .for("update")
          .limit(1);

        if (!user) {
          [user] = await transaction
            .insert(users)
            .values({ phone, role: "patient", status: "active" })
            .onConflictDoNothing({ target: users.phone })
            .returning();
        }
        if (!user) {
          [user] = await transaction
            .select()
            .from(users)
            .where(eq(users.phone, phone))
            .for("update")
            .limit(1);
        }
        if (!user) throw new Error("OTP user provisioning failed.");
        if (user.role !== "patient" && user.role !== "guardian") {
          throw new UnauthorizedException(
            "Staff must authenticate through OIDC"
          );
        }

        const [patient] = await transaction
          .select({ id: patients.id })
          .from(patients)
          .where(eq(patients.userId, user.id))
          .for("update")
          .limit(1);

        if (!patient) {
          await transaction.insert(patients).values({
            userId: user.id,
            healthId: `MEDIQR-${randomUUID()}`,
            fullName: "Not provided",
            phoneHash: hashPatientPhone(phone),
            encryptedPhone: encryptPatientPhone(phone)
          });
        }

        return { resolvedUser: user, patientCreated: !patient };
      }
    );
    if (patientCreated) this.logger.log("Patient profile provisioned.");

    // 7. Issue refresh token + session
    const refreshTokenRaw = randomBytes(64).toString("hex");
    const refreshTokenHash = sha256(refreshTokenRaw);
    const accessTokenId = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    const [session] = await db
      .insert(sessions)
      .values({
        userId: resolvedUser.id,
        accessTokenIdHash: sha256(accessTokenId),
        refreshTokenHash,
        deviceInfo: userAgent.slice(0, 255),
        ipAddress: "hashed",
        expiresAt
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error("Failed to create patient session.");

    // 8. Mint short-lived access JWT (5 minutes)
    const accessToken = await new SignJWT({
      mediqr_user_id: resolvedUser.id,
      role: resolvedUser.role,
      facility_id: resolvedUser.facilityId
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(resolvedUser.id)
      .setJti(accessTokenId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setIssuer("mediqr-api")
      .setAudience("mediqr-api")
      .sign(Buffer.from(env.SESSION_SECRET));

    const csrfToken = randomBytes(32).toString("hex");
    this.setCookies(reply, accessToken, refreshTokenRaw, csrfToken);

    await this.auditService.log({
      actorId: resolvedUser.id,
      actorRole: resolvedUser.role,
      action: "AUTH_OTP_VERIFY_SUCCESS",
      resourceType: "auth",
      resourceId: resolvedUser.id,
      outcome: "SUCCESS",
      ipHash,
      userAgent: userAgent.slice(0, 255)
    });

    return { message: "Authentication successful", csrfToken };
  }

  // ---------------------------------------------------------------------------
  // Refresh & Session Family Revocation (Condition 4)
  // ---------------------------------------------------------------------------
  async refreshSession(
    refreshTokenRaw: string | undefined,
    ipHash: string,
    userAgent: string,
    reply: FastifyReply
  ): Promise<{ message: string; csrfToken: string }> {
    if (!refreshTokenRaw) {
      throw new UnauthorizedException("Missing refresh token");
    }

    const tokenHash = sha256(refreshTokenRaw);
    const now = new Date();

    // 1. Search for active, non-revoked session
    const [activeSession] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.refreshTokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    if (!activeSession) {
      // 2. Check if this token belongs to an already-revoked session (REUSE DETECTION)
      const [revokedSession] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, tokenHash))
        .limit(1);

      if (revokedSession) {
        // REUSE DETECTED: Revoke the entire session family for this user
        await db
          .update(sessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(sessions.userId, revokedSession.userId),
              isNull(sessions.revokedAt)
            )
          );

        this.clearCookies(reply);

        await this.auditService.log({
          actorId: revokedSession.userId,
          action: "AUTH_REFRESH_TOKEN_REUSE_DETECTED",
          resourceType: "session",
          resourceId: revokedSession.id,
          outcome: "DENIED",
          ipHash
        });

        throw new UnauthorizedException(
          "Session family revoked due to token reuse detection"
        );
      }

      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, activeSession.userId))
      .limit(1);

    if (!userRow || userRow.status !== "active") {
      throw new UnauthorizedException("Account suspended");
    }

    // 3. Rotate: revoke old token immediately, issue new
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(eq(sessions.id, activeSession.id));

    const newRefreshRaw = randomBytes(64).toString("hex");
    const newRefreshHash = sha256(newRefreshRaw);
    const accessTokenId = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    await db.insert(sessions).values({
      userId: userRow.id,
      accessTokenIdHash: sha256(accessTokenId),
      refreshTokenHash: newRefreshHash,
      deviceInfo: userAgent.slice(0, 255),
      ipAddress: "hashed",
      expiresAt
    });

    const accessToken = await new SignJWT({
      mediqr_user_id: userRow.id,
      role: userRow.role,
      facility_id: userRow.facilityId
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userRow.id)
      .setJti(accessTokenId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setIssuer("mediqr-api")
      .setAudience("mediqr-api")
      .sign(Buffer.from(env.SESSION_SECRET));

    const csrfToken = randomBytes(32).toString("hex");
    this.setCookies(reply, accessToken, newRefreshRaw, csrfToken);

    await this.auditService.log({
      actorId: userRow.id,
      actorRole: userRow.role,
      action: "AUTH_REFRESH",
      resourceType: "session",
      resourceId: activeSession.id,
      outcome: "SUCCESS",
      ipHash
    });

    return { message: "Token refreshed", csrfToken };
  }

  // ---------------------------------------------------------------------------
  // Logout (current session)
  // ---------------------------------------------------------------------------
  async logout(
    user: AuthenticatedUser,
    refreshTokenRaw: string | undefined,
    ipHash: string,
    reply: FastifyReply
  ): Promise<{ message: string }> {
    if (user.sessionId) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(sessions.id, user.sessionId), isNull(sessions.revokedAt))
        );
    } else if (refreshTokenRaw) {
      const hash = sha256(refreshTokenRaw);
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.refreshTokenHash, hash));
    }

    this.clearCookies(reply);

    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: "AUTH_LOGOUT",
      resourceType: "session",
      resourceId: "current",
      outcome: "SUCCESS",
      ipHash
    });

    return { message: "Logged out" };
  }

  // ---------------------------------------------------------------------------
  // Logout Everywhere (all sessions)
  // ---------------------------------------------------------------------------
  async logoutEverywhere(
    user: AuthenticatedUser,
    ipHash: string,
    reply: FastifyReply
  ): Promise<{ message: string }> {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));

    this.clearCookies(reply);

    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: "AUTH_SESSION_REVOKE_ALL",
      resourceType: "session",
      resourceId: user.id,
      outcome: "SUCCESS",
      ipHash
    });

    return { message: "All sessions revoked" };
  }

  async getCurrentUserProfile(
    user: AuthenticatedUser
  ): Promise<AuthenticatedUser & { patientId: string | null }> {
    const patient = await db.query.patients.findFirst({
      columns: { id: true },
      where: (patientRecord, { eq: equals }) =>
        equals(patientRecord.userId, user.id)
    });

    return { ...user, patientId: patient?.id ?? null };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private setCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    csrfToken: string
  ): void {
    const baseOpts = {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: true,
      path: "/"
    };

    reply.setCookie(ACCESS_COOKIE, accessToken, {
      ...baseOpts,
      maxAge: 300 // 5 minutes
    });

    reply.setCookie(REFRESH_COOKIE, refreshToken, {
      ...baseOpts,
      maxAge: 28800 // 8 hours
    });

    // CSRF cookie: NOT httpOnly — JS must read it to set the header
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      sameSite: "strict" as const,
      secure: true,
      path: "/",
      maxAge: 300
    });
  }

  private clearCookies(reply: FastifyReply): void {
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
  }
}
