import { Module } from "@nestjs/common";
import { env } from "../../config/env.js";
import {
  MailpitNotificationEmailProvider,
  NoopNotificationEmailProvider,
} from "./mailpit-notification-email.provider.js";
import { NOTIFICATION_EMAIL_PROVIDER } from "./notification-email.provider.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_EMAIL_PROVIDER,
      useFactory: () =>
        env.NODE_ENV === "development"
          ? new MailpitNotificationEmailProvider(env)
          : new NoopNotificationEmailProvider(),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
