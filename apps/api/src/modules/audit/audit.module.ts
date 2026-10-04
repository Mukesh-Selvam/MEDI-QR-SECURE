import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { AuditChainVerifier } from "./audit-chain-verifier.js";

@Module({
  providers: [AuditService, AuditChainVerifier],
  exports: [AuditService],
})
export class AuditModule {}
