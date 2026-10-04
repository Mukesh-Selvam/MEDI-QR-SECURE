import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { QrCredentialsService } from "./qr-credentials.service.js";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";

@Controller("qr/credentials")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class QrCredentialsController {
  constructor(private readonly credentials: QrCredentialsService) {}

  @Get()
  @RequirePolicy({ resource: "patient", action: "update" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.credentials.list(user.id, user.role);
  }

  @Post()
  @RequirePolicy({ resource: "patient", action: "update" })
  issueOrRotate(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.credentials.issueOrRotate(
      user.id,
      user.role,
      hashIp(request.ip ?? "0.0.0.0")
    );
  }

  @Delete(":id")
  @RequirePolicy({ resource: "patient", action: "update" })
  async revoke(
    @Param("id", ParseUUIDPipe) credentialId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ revoked: true }> {
    await this.credentials.revoke(
      user.id,
      user.role,
      credentialId,
      hashIp(request.ip ?? "0.0.0.0")
    );
    return { revoked: true };
  }

  @Get("current")
  @RequirePolicy({ resource: "patient", action: "update" })
  getInAppToken(@CurrentUser() user: AuthenticatedUser) {
    return this.credentials.getInAppToken(user.id, user.role);
  }
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
