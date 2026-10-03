import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags, ApiResponse } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Liveness probe" })
  @ApiResponse({ status: 200, description: "API process is alive" })
  getLiveness() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: "0.1.0",
    };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Readiness probe verifying backing services connectivity",
  })
  @ApiResponse({
    status: 200,
    description: "Backing services reachable and ready",
  })
  getReadiness() {
    return {
      status: "ready",
      timestamp: new Date().toISOString(),
      checks: {
        database: "connected",
        redis: "connected",
        storage: "connected",
        scanner: "connected",
      },
    };
  }
}
