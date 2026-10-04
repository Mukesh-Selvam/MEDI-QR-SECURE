import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ConsentController } from "./consent.controller.js";
import { ConsentService } from "./consent.service.js";

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
