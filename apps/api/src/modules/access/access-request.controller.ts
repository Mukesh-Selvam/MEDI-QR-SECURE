import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { createAccessRequestSchema } from "./access-request.schema.js";
import { AccessRequestService } from "./access-request.service.js";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";

@Controller("access/requests")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AccessRequestController {
  constructor(
    @Inject(AccessRequestService)
    private readonly accessRequests: AccessRequestService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePolicy({ resource: "access-request", action: "create" })
  create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const parsed = createAccessRequestSchema.safeParse(body);
    if (!parsed.success) {
      const invalidFields = parsed.error.issues
        .map((issue) => String(issue.path[0] ?? "request"))
        .join(", ");
      throw new BadRequestException(`Invalid access request: ${invalidFields}`);
    }

    const ipHash = createHash("sha256")
      .update(request.ip ?? "0.0.0.0")
      .digest("hex");
    return this.accessRequests.create(user, parsed.data, ipHash);
  }
}
