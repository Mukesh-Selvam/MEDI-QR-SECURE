import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { createEmergencyAccessRequestSchema } from "./emergency-access.schema.js";
import { EmergencyAccessService } from "./emergency-access.service.js";

@Controller("emergency-access")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class EmergencyAccessController {
  constructor(
    @Inject(EmergencyAccessService)
    private readonly emergencyAccess: EmergencyAccessService,
  ) {}

  @Post("facilities/:facilityId/requests")
  @HttpCode(HttpStatus.CREATED)
  @RequirePolicy({ resource: "emergency-access", action: "request" })
  createRequest(
    @Param("facilityId", ParseUUIDPipe) facilityId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    const parsed = createEmergencyAccessRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid emergency access request.");
    }

    return this.emergencyAccess.createRequest(
      facilityId,
      parsed.data,
      actor,
      request.ip ?? "0.0.0.0",
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"]
        : undefined,
    );
  }

  @Get("requests/:requestId/summary")
  @RequirePolicy({ resource: "emergency-access", action: "read-summary" })
  async readSummary(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return this.emergencyAccess.readSummary(
      requestId,
      actor,
      request.ip ?? "0.0.0.0",
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"]
        : undefined,
    );
  }
}
