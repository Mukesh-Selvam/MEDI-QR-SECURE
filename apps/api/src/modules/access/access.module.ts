import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { QrModule } from "../qr/qr.module.js";
import { AccessRequestController } from "./access-request.controller.js";
import { AccessRequestService } from "./access-request.service.js";

@Module({
  imports: [AuditModule, QrModule],
  controllers: [AccessRequestController],
  providers: [AccessRequestService],
  exports: [AccessRequestService],
})
export class AccessModule {}
