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

  it("converts transport errors to a sanitized delivery error", async () => {
    mocks.sendMail.mockRejectedValue(new Error("sensitive transport detail"));
    const provider = new MailpitNotificationEmailProvider(config);

    await expect(
      provider.send({
        recipient: "fake-patient@mediqr.invalid",
        eventType: "ACCESS_REQUESTED",
        requestId: "00000000-0000-0000-0000-000000000001",
        createdAt: new Date(),
      })
    ).rejects.toBeInstanceOf(NotificationEmailDeliveryError);
  });
});
