import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { FacilitiesController } from "./facilities.controller.js";
import { FacilitiesService } from "./facilities.service.js";

@Module({
  imports: [AuditModule],
  controllers: [FacilitiesController],
  providers: [FacilitiesService],
})
export class FacilitiesModule {}
