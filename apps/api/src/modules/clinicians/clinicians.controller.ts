import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { clinicians } from "../../database/schema.js";
import { AuditService } from "../audit/audit.service.js";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";

const clinicianIdSchema = z.string().uuid();
const verificationBodySchema = z.object({ isVerified: z.boolean() }).strict();
type ClinicianAudit = Pick<
  AuditService,
  "hashIp" | "logInTransaction" | "commitTransactionHash"
>;

@Controller("clinicians")
export class CliniciansController {
  constructor(@Inject(AuditService) private readonly audit: ClinicianAudit) {}

  @RequirePolicy({ resource: "clinician", action: "verify" })
  @Patch(":id/verification")
  async setVerification(
    @Param("id") clinicianId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest
  ): Promise<{ id: string; isVerified: boolean }> {
    if (actor.role !== "platform-admin") {
      throw new ForbiddenException("Only platform administrators can verify clinicians.");
    }

    const parsedId = clinicianIdSchema.safeParse(clinicianId);
    const parsedBody = verificationBodySchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success) {
      throw new BadRequestException("Invalid clinician verification request.");
    }

    const { isVerified } = parsedBody.data;
    const event = {
      actorId: actor.id,
      actorRole: actor.role,
      action: isVerified ? ("CLINICIAN_VERIFIED" as const) : ("CLINICIAN_SUSPENDED" as const),
      resourceType: "clinician",
      resourceId: parsedId.data,
      outcome: "SUCCESS" as const,
      ipHash: this.audit.hashIp(request.ip ?? "unknown"),
      userAgent:
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"]
          : undefined,
    };

    const integrityHash = await db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(clinicians)
        .set({
          isVerified,
          verifiedAt: isVerified ? new Date() : null,
          verifiedBy: isVerified ? actor.id : null,
          updatedAt: new Date(),
        })
        .where(eq(clinicians.id, parsedId.data))
        .returning({ id: clinicians.id, isVerified: clinicians.isVerified });

      if (!updated) throw new NotFoundException("Clinician not found.");
      const hash = await this.audit.logInTransaction(event, transaction);
      return { updated, hash };
    });
    this.audit.commitTransactionHash(integrityHash.hash);
    return integrityHash.updated;
  }
}
