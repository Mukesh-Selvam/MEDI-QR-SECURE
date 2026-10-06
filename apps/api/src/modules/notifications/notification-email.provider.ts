export const NOTIFICATION_EMAIL_PROVIDER = Symbol(
  "NOTIFICATION_EMAIL_PROVIDER",
);

export interface NotificationEmail {
  recipient: string;
  eventType: string;
  requestId: string;
  createdAt: Date;
}

export interface StaffInvitationEmail {
  recipient: string;
  invitationId: string;
  invitationToken: string;
  expiresAt: Date;
}

export interface NotificationEmailProvider {
  readonly enabled: boolean;
  send(notification: NotificationEmail): Promise<void>;
  sendStaffInvitation(invitation: StaffInvitationEmail): Promise<void>;
}

export class NotificationEmailDeliveryError extends Error {
  constructor() {
    super("Development notification email delivery failed.");
    this.name = "NotificationEmailDeliveryError";
  }
}
