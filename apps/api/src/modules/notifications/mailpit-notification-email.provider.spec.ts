import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import { MailpitNotificationEmailProvider } from "./mailpit-notification-email.provider.js";
import { NotificationEmailDeliveryError } from "./notification-email.provider.js";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  createTransport: mocks.createTransport,
}));

const config: Pick<
  Env,
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "MAIL_FROM_ADDRESS"
> = {
  SMTP_HOST: "mailpit",
  SMTP_PORT: 1025,
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  MAIL_FROM_ADDRESS: "notifications@mediqr.invalid",
};

describe("MailpitNotificationEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMail.mockResolvedValue(undefined);
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("sends only the generic event, opaque request reference, and time", async () => {
    const provider = new MailpitNotificationEmailProvider(config);
    const createdAt = new Date("2026-01-02T03:04:05.000Z");

    await provider.send({
      recipient: "fake-patient@mediqr.invalid",
      eventType: "DOCUMENT_READ",
      requestId: "00000000-0000-0000-0000-000000000001",
      createdAt,
    });

    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: "notifications@mediqr.invalid",
      to: "fake-patient@mediqr.invalid",
      subject: "MediQR access update",
      text: [
        "Event: DOCUMENT_READ",
        "Request reference: 00000000-0000-0000-0000-000000000001",
        "Time: 2026-01-02T03:04:05.000Z",
      ].join("\n"),
    });
  });

  it("uses generic wording for emergency-access notifications", async () => {
    const provider = new MailpitNotificationEmailProvider(config);
    const requestId = "00000000-0000-0000-0000-000000000001";
    const createdAt = new Date("2026-01-02T03:04:05.000Z");

    await provider.send({
      recipient: "fake-patient@mediqr.invalid",
      eventType: "EMERGENCY_ACCESS_GRANTED",
      requestId,
      createdAt,
    });

    const sentEmail = mocks.sendMail.mock.calls[0]?.[0] as
      { text: string } | undefined;
    expect(sentEmail?.text).toContain("An emergency access event occurred.");
    expect(sentEmail?.text).toContain(
      "Sign in to your MediQR account to review this notification.",
    );
    expect(sentEmail?.text).not.toContain("EMERGENCY_ACCESS_GRANTED");
    for (const sensitiveText of [
      "allergies",
      "blood group",
      "Fake Patient",
      "+919000000000",
    ]) {
      expect(sentEmail?.text).not.toContain(sensitiveText);
    }
    expect(sentEmail?.text).not.toMatch(/https?:\/\/|www\.|href=/i);
    expect(sentEmail).not.toHaveProperty("html");
    expect(sentEmail?.text).toContain(requestId);
  });

  it("delivers the one-time invitation only to the invited address", async () => {
    const provider = new MailpitNotificationEmailProvider(config);
    const invitationToken =
      "fake-invitation-token-that-is-not-a-patient-secret";
    const expiresAt = new Date("2026-10-07T00:00:00.000Z");

    await provider.sendStaffInvitation({
      recipient: "fake-staff@mediqr.invalid",
      invitationId: "00000000-0000-0000-0000-000000000001",
      invitationToken,
      expiresAt,
    });

    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: "notifications@mediqr.invalid",
      to: "fake-staff@mediqr.invalid",
      subject: "MediQR staff invitation",
      text: [
        "A facility has invited you to join its staff roster.",
        "Sign in through the staff identity provider with MFA, then enter this one-time invitation code:",
        invitationToken,
        "Invitation reference: 00000000-0000-0000-0000-000000000001",
        "Expires: 2026-10-07T00:00:00.000Z",
      ].join("\n"),
    });
    const delivered = mocks.sendMail.mock.calls[0]?.[0] as
      { text: string } | undefined;
    expect(delivered?.text).not.toMatch(/https?:\/\/|www\.|href=/i);
  });

  it("converts transport errors to a sanitized delivery error", async () => {
    mocks.sendMail.mockRejectedValue(new Error("sensitive transport detail"));
    const provider = new MailpitNotificationEmailProvider(config);

    await expect(
      provider.send({
        recipient: "fake-patient@mediqr.invalid",
        eventType: "ACCESS_REQUESTED",
        requestId: "00000000-0000-0000-0000-000000000001",
        createdAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotificationEmailDeliveryError);
  });
});
