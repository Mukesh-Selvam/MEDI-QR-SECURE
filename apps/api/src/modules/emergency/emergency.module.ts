import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QrModule } from "../qr/qr.module.js";
import { VaultModule } from "../vault/vault.module.js";
import { EmergencyAccessController } from "./emergency-access.controller.js";
import { EmergencyAccessService } from "./emergency-access.service.js";
import { EmergencyProfileController } from "./emergency-profile.controller.js";
import { EmergencyProfileService } from "./emergency-profile.service.js";

@Module({
  imports: [AuditModule, NotificationsModule, QrModule, VaultModule],
  controllers: [EmergencyAccessController, EmergencyProfileController],
  providers: [EmergencyAccessService, EmergencyProfileService],
})
export class EmergencyModule {}
