import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { runAllChecks } from "./health.checks.js";
import { PublicRoute } from "../auth/decorators/public.decorator.js";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  /**
   * Liveness probe — returns 200 if the Node process is alive.
   * Intentionally does NOT check external dependencies.
   * Kubernetes/load-balancers use this to detect a crashed process.
   */
  @PublicRoute()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Liveness probe — process is alive" })
  @ApiResponse({ status: 200, description: "Process is alive" })
  getLiveness() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: "0.1.0",
    };
  }

  /**
   * Readiness probe — performs REAL calls to all 4 backing services.
   * Returns HTTP 200 only when every check passes.
   * Returns HTTP 503 with a `failing` array when any check fails.
   *
   * Checks:
   *   database → SELECT 1 on Postgres (2 s timeout)
   *   redis    → PING / PONG (2 s timeout)
   *   storage  → MinIO /minio/health/live + HEAD bucket (2 s timeout)
   *   scanner  → ClamAV zPING / PONG on TCP socket (2 s timeout)
   */
  @PublicRoute()
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe — real dependency checks" })
  @ApiResponse({ status: 200, description: "All backing services reachable" })
  @ApiResponse({
    status: 503,
    description: "One or more backing services unreachable",
  })
  async getReadiness(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await runAllChecks();

    if (result.status !== "ready") {
      reply.statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    }

    return result;
  }
}
