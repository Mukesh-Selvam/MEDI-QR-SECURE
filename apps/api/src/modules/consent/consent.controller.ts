import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { ConsentService } from "./consent.service.js";

@Controller("consents")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  @Post(":id/revoke")
  @RequirePolicy({ resource: "consent", action: "revoke" })
  revoke(
    @Param("id", ParseUUIDPipe) consentId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const ipHash = createHash("sha256")
      .update(request.ip ?? "0.0.0.0")
      .digest("hex");
    return this.consents.revoke(consentId, user, ipHash);
  }
}
