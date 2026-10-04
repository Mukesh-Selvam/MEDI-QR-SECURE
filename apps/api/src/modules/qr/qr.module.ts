import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { QrCredentialsController } from "./qr-credentials.controller.js";
import { QrCredentialsService } from "./qr-credentials.service.js";
import { QrResolutionController } from "./qr-resolution.controller.js";
import { QrResolutionService, QR_REDIS_CLIENT } from "./qr-resolution.service.js";
import { createRedisClient } from "../../config/redis.config.js";

@Module({
  imports: [AuditModule],
  controllers: [QrCredentialsController, QrResolutionController],
  providers: [
    QrCredentialsService,
    { provide: QR_REDIS_CLIENT, useFactory: () => createRedisClient() },
    QrResolutionService,
  ],
  exports: [QrCredentialsService, QrResolutionService],
})
export class QrModule {}
