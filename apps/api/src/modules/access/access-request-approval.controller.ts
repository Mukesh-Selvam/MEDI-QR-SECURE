import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { AccessRequestApprovalService } from "./access-request-approval.service.js";

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

@Controller("access/requests")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AccessRequestApprovalController {
  constructor(private readonly approvals: AccessRequestApprovalService) {}

  @Get("inbox")
  @RequirePolicy({ resource: "access-request", action: "list" })
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.approvals.listPending(user);
  }

  @Post(":id/approve")
  @RequirePolicy({ resource: "access-request", action: "approve" })
  approve(
    @Param("id", ParseUUIDPipe) requestId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.approvals.approve(
      requestId,
      user,
      hashIp(request.ip ?? "0.0.0.0")
    );
  }

  @Post(":id/deny")
  @RequirePolicy({ resource: "access-request", action: "deny" })
  deny(
    @Param("id", ParseUUIDPipe) requestId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.approvals.deny(
      requestId,
      user,
      hashIp(request.ip ?? "0.0.0.0")
    );
  }

  @Post(":id/otp")
  @RequirePolicy({ resource: "access-request", action: "issue-otp" })
  issueOtp(
    @Param("id", ParseUUIDPipe) requestId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.approvals.issueApprovalOtp(
      requestId,
      user,
      hashIp(request.ip ?? "0.0.0.0")
    );
  }

  @Post(":id/approve-with-otp")
  @RequirePolicy({ resource: "access-request", action: "approve-with-otp" })
  approveWithOtp(
    @Param("id", ParseUUIDPipe) requestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid approval code");
    }
    return this.approvals.approveWithOtp(
      requestId,
      parsed.data.code,
      user,
      hashIp(request.ip ?? "0.0.0.0")
    );
  }
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
