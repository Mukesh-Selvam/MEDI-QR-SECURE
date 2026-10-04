import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CliniciansController } from "./clinicians.controller.js";

@Module({
  imports: [AuditModule],
  controllers: [CliniciansController],
})
export class CliniciansModule {}
