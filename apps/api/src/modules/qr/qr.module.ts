import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { QrCredentialsController } from "./qr-credentials.controller.js";
import { QrCredentialsService } from "./qr-credentials.service.js";

@Module({
  imports: [AuditModule],
  controllers: [QrCredentialsController],
  providers: [QrCredentialsService],
  exports: [QrCredentialsService],
})
export class QrModule {}
