import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { VaultModule } from "../vault/vault.module.js";
import { EmergencyProfileController } from "./emergency-profile.controller.js";
import { EmergencyProfileService } from "./emergency-profile.service.js";

@Module({
  imports: [AuditModule, VaultModule],
  controllers: [EmergencyProfileController],
  providers: [EmergencyProfileService],
})
export class EmergencyModule {}
