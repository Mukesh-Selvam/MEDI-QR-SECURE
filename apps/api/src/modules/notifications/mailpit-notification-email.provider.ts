import { createTransport, type Transporter } from "nodemailer";
import type { Env } from "../../config/env.js";
import {
  NotificationEmailDeliveryError,
  type NotificationEmail,
  type NotificationEmailProvider,
  type StaffInvitationEmail,
} from "./notification-email.provider.js";

export class MailpitNotificationEmailProvider implements NotificationEmailProvider {
  readonly enabled = true;
  private readonly transport: Transporter;

  constructor(
    private readonly config: Pick<
      Env,
      | "SMTP_HOST"
      | "SMTP_PORT"
      | "SMTP_USER"
      | "SMTP_PASSWORD"
      | "MAIL_FROM_ADDRESS"
    >,
  ) {
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(notification: NotificationEmail): Promise<void> {
    try {
      const text =
        notification.eventType === "EMERGENCY_ACCESS_GRANTED"
          ? [
              "An emergency access event occurred.",
              "Sign in to your MediQR account to review this notification.",
              `Reference: ${notification.requestId}`,
              `Time: ${notification.createdAt.toISOString()}`,
            ].join("\n")
          : [
              `Event: ${notification.eventType}`,
              `Request reference: ${notification.requestId}`,
              `Time: ${notification.createdAt.toISOString()}`,
            ].join("\n");
      await this.transport.sendMail({
        from: this.config.MAIL_FROM_ADDRESS,
        to: notification.recipient,
        subject: "MediQR access update",
        text,
      });
    } catch {
      throw new NotificationEmailDeliveryError();
    }
  }

  async sendStaffInvitation(invitation: StaffInvitationEmail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.MAIL_FROM_ADDRESS,
        to: invitation.recipient,
        subject: "MediQR staff invitation",
        text: [
          "A facility has invited you to join its staff roster.",
          "Sign in through the staff identity provider with MFA, then enter this one-time invitation code:",
          invitation.invitationToken,
          `Invitation reference: ${invitation.invitationId}`,
          `Expires: ${invitation.expiresAt.toISOString()}`,
        ].join("\n"),
      });
    } catch {
      throw new NotificationEmailDeliveryError();
    }
  }
}

export class NoopNotificationEmailProvider implements NotificationEmailProvider {
  readonly enabled = false;

  async send(_notification: NotificationEmail): Promise<void> {
    return Promise.resolve();
  }

  async sendStaffInvitation(_invitation: StaffInvitationEmail): Promise<void> {
    return Promise.resolve();
  }
}
