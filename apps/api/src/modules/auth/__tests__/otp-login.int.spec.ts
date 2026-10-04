import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { and, eq, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomInt } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../config/env.js";
import { db, pool } from "../../../database/index.js";
import { auditEvents, sessions, users } from "../../../database/schema.js";
import { AuditService } from "../../audit/audit.service.js";
import { AuthModule } from "../auth.module.js";

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
}

interface MailpitMessageList {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
}

describe("Patient OTP login (integration)", () => {
  let app!: NestFastifyApplication;
  let fastify!: FastifyInstance;
  let testPhone!: string;
  let testIp!: string;
  let userId: string | undefined;
  let auditIpHash!: string;
  let startedAt!: Date;

  beforeAll(async () => {
    const columns = await pool.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = $1 and
         ((table_name = $2 and column_name = $3) or
          (table_name = $4 and column_name = $5) or
          (table_name = $6 and column_name = $7))`,
      [
        "public",
        "users",
        "facility_id",
        "patient_facility_relationships",
        "patient_id",
        "sessions",
        "access_token_id_hash",
      ]
    );
    expect(
      columns.rows.map((row) => `${row.table_name}.${row.column_name}`)
    ).toEqual(
      expect.arrayContaining([
        "users.facility_id",
        "patient_facility_relationships.patient_id",
        "sessions.access_token_id_hash",
      ])
    );

    await waitForService(`${env.KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(env.KEYCLOAK_REALM)}/.well-known/openid-configuration`);
    await waitForService("http://127.0.0.1:8025/api/v1/messages?limit=1");

    app = await NestFactory.create<NestFastifyApplication>(
      AuthModule,
      new FastifyAdapter({ logger: false })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await app.register(fastifyCookie as any, { secret: env.SESSION_SECRET });
    app.setGlobalPrefix("api/v1");
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();

    testPhone = `+919${randomInt(0, 1_000_000_000).toString().padStart(9, "0")}`;
    testIp = `127.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
    auditIpHash = app.get(AuditService).hashIp(testIp);
    startedAt = new Date(Date.now() - 1000);
  }, 90000);

  afterAll(async () => {
    if (userId) {
      await db
        .delete(auditEvents)
        .where(eq(auditEvents.actorId, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }

    if (auditIpHash && startedAt) {
      await db
        .delete(auditEvents)
        .where(
          and(
            eq(auditEvents.ipHash, auditIpHash),
            eq(auditEvents.action, "AUTH_OTP_SEND"),
            gte(auditEvents.timestamp, startedAt)
          )
        );
    }

    await app?.close();
    await pool.end();
  });

  it("sends and verifies OTP, creates a session, sets cookies, and writes audit events", async () => {
    const sendResponse = await fastify.inject({
      method: "POST",
      url: "/api/v1/auth/otp/send",
      payload: { phone: testPhone },
      remoteAddress: testIp,
    });
    expect(sendResponse.statusCode).toBe(200);

    const otp = await readOtpFromMailpit(testPhone);
    const verifyResponse = await fastify.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: { phone: testPhone, otp },
      remoteAddress: testIp,
    });
    expect(verifyResponse.statusCode).toBe(200);

    const setCookieHeader = verifyResponse.headers["set-cookie"];
    const cookieHeaders = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader ?? ""];
    const cookieNames = cookieHeaders.map((cookie) => cookie.split("=")[0]);
    expect(cookieNames).toEqual(
      expect.arrayContaining([
        "__Host-mediqr-access",
        "__Host-mediqr-refresh",
        "__Host-mediqr-csrf",
      ])
    );
    expect(cookieHeaders).toHaveLength(3);
    const cookiesByName = new Map(
      cookieHeaders.map((cookie) => [cookie.split("=")[0], cookie])
    );
    for (const name of cookieNames) {
      const cookie = cookiesByName.get(name) ?? "";
      expect(/;\s*Secure/i.test(cookie)).toBe(true);
      expect(/;\s*SameSite=Strict/i.test(cookie)).toBe(true);
      expect(/;\s*Path=\/(?:;|$)/i.test(cookie)).toBe(true);
    }
    expect(/;\s*HttpOnly/i.test(cookiesByName.get("__Host-mediqr-access") ?? "")).toBe(true);
    expect(/;\s*HttpOnly/i.test(cookiesByName.get("__Host-mediqr-refresh") ?? "")).toBe(true);
    expect(/;\s*HttpOnly/i.test(cookiesByName.get("__Host-mediqr-csrf") ?? "")).toBe(false);

    const body = JSON.parse(verifyResponse.body) as { csrfToken?: unknown };
    expect(typeof body.csrfToken).toBe("string");

    const authenticatedCookies = cookieHeaders
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const user = await db.query.users.findFirst({
      columns: { id: true },
      where: eq(users.phone, testPhone),
    });
    expect(user).toBeDefined();
    userId = user?.id;
    if (!userId) throw new Error("OTP verification did not provision a user.");

    const activeSessions = await db
      .select({
        id: sessions.id,
        lastActiveAt: sessions.lastActiveAt,
        accessTokenIdHash: sessions.accessTokenIdHash,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0]?.accessTokenIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(activeSessions[0]?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
      startedAt.getTime()
    );

    const verifyAudits = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, userId),
          eq(auditEvents.action, "AUTH_OTP_VERIFY_SUCCESS")
        )
      );
    expect(verifyAudits).toHaveLength(1);

    const sendAudits = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.ipHash, auditIpHash),
          eq(auditEvents.action, "AUTH_OTP_SEND"),
          gte(auditEvents.timestamp, startedAt)
        )
      );
    expect(sendAudits.length).toBeGreaterThan(0);

    const sessionId = activeSessions[0]?.id;
    if (!sessionId) throw new Error("OTP verification did not persist a session.");
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    const revokedRequest = await fastify.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: authenticatedCookies },
    });
    expect(revokedRequest.statusCode).toBe(401);
  }, 90000);
});

async function waitForService(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("A required integration service did not become ready.");
}

async function readOtpFromMailpit(phone: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const listResponse = await fetch(
      "http://127.0.0.1:8025/api/v1/messages?limit=50"
    );
    const list = (await listResponse.json()) as MailpitMessageList;
    const matchingMessage = list.messages.find((message) =>
      message.Subject.includes(phone)
    );

    if (matchingMessage) {
      const detailResponse = await fetch(
        `http://127.0.0.1:8025/api/v1/message/${encodeURIComponent(matchingMessage.ID)}`
      );
      const detail = (await detailResponse.json()) as MailpitMessage;
      const otp = /one-time password is:\s*(\d{6})/.exec(detail.Text)?.[1];
      if (otp) return otp;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The development OTP was not delivered to Mailpit.");
}
