import {
  Body,
  Controller,
  Delete,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { FacilitiesService } from "./facilities.service.js";

@Controller("facilities")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class FacilitiesController {
  constructor(
    @Inject(FacilitiesService) private readonly facilities: FacilitiesService,
  ) {}

  @RequirePolicy({ resource: "emergency-access", action: "register-facility" })
  @Post()
  createFacility(
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.createFacility(
      body,
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({ resource: "emergency-access", action: "verify" })
  @Patch(":facilityId/verification")
  changeVerification(
    @Param("facilityId") facilityId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.changeVerification(
      facilityId,
      body,
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({
    resource: "facility-affiliation",
    action: "create-facility-admin",
  })
  @Post(":facilityId/administrators")
  createFacilityAdminAffiliation(
    @Param("facilityId") facilityId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.createFacilityAdminAffiliation(
      facilityId,
      body,
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({ resource: "facility-affiliation", action: "create-staff" })
  @Post(":facilityId/affiliations")
  createStaffAffiliation(
    @Param("facilityId") facilityId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.createStaffAffiliation(
      facilityId,
      body,
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({ resource: "facility-affiliation", action: "activate-staff" })
  @Patch(":facilityId/affiliations/:affiliationId/activate")
  activateStaffAffiliation(
    @Param("facilityId") facilityId: string,
    @Param("affiliationId") affiliationId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.updateStaffAffiliation(
      facilityId,
      affiliationId,
      "activate",
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({ resource: "facility-affiliation", action: "suspend" })
  @Patch(":facilityId/affiliations/:affiliationId/suspend")
  suspendAffiliation(
    @Param("facilityId") facilityId: string,
    @Param("affiliationId") affiliationId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.updateStaffAffiliation(
      facilityId,
      affiliationId,
      "suspend",
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  @RequirePolicy({ resource: "facility-affiliation", action: "revoke" })
  @Delete(":facilityId/affiliations/:affiliationId")
  revokeAffiliation(
    @Param("facilityId") facilityId: string,
    @Param("affiliationId") affiliationId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.facilities.updateStaffAffiliation(
      facilityId,
      affiliationId,
      "revoke",
      actor,
      request.ip ?? "unknown",
      this.userAgent(request),
    );
  }

  private userAgent(request: FastifyRequest): string | undefined {
    const userAgent = request.headers["user-agent"];
    return typeof userAgent === "string" ? userAgent : undefined;
  }
}
