import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  CurrentUser,
  type AuthenticatedUser
} from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { EmergencyProfileService } from "./emergency-profile.service.js";
import { emergencyProfileSchema } from "./emergency-profile.schema.js";

@Controller("emergency/profiles")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class EmergencyProfileController {
  constructor(
    @Inject(EmergencyProfileService)
    private readonly profiles: EmergencyProfileService
  ) {}

  @Get(":patientId")
  @RequirePolicy({ resource: "emergency-profile", action: "read" })
  read(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest
  ) {
    const agent = request.headers["user-agent"];
    return this.profiles.read(
      patientId,
      actor,
      request.ip,
      typeof agent === "string" ? agent : undefined
    );
  }

  @Put(":patientId")
  @RequirePolicy({ resource: "emergency-profile", action: "update" })
  update(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest
  ) {
    const parsed = emergencyProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid emergency profile.");
    }
    const agent = request.headers["user-agent"];
    return this.profiles.update(
      patientId,
      actor,
      parsed.data,
      request.ip,
      typeof agent === "string" ? agent : undefined
    );
  }
}
