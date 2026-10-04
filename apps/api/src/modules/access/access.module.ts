import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { QrModule } from "../qr/qr.module.js";
import { AccessRequestController } from "./access-request.controller.js";
import { AccessRequestService } from "./access-request.service.js";
import { AccessRequestApprovalController } from "./access-request-approval.controller.js";
import { AccessRequestApprovalService } from "./access-request-approval.service.js";

@Module({
  imports: [AuditModule, QrModule],
  controllers: [AccessRequestController, AccessRequestApprovalController],
  providers: [AccessRequestService, AccessRequestApprovalService],
  exports: [AccessRequestService, AccessRequestApprovalService],
})
export class AccessModule {}
