import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { PublicRoute } from "../auth/decorators/public.decorator.js";
import { QrResolutionService } from "./qr-resolution.service.js";

const resolveQrSchema = z
  .object({
    token: z.string().min(1).max(2048),
    resolutionId: z.string().uuid(),
  })
  .strict();

const GENERIC_RESOLUTION_RESPONSE = Object.freeze({
  status: "request-access",
  message: "Continue to request access through the secure flow.",
});

@Controller("qr")
export class QrResolutionController {
  constructor(private readonly resolution: QrResolutionService) {}

  @Post("resolve")
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  async resolve(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<typeof GENERIC_RESOLUTION_RESPONSE> {
    const parsed = resolveQrSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid QR resolution request");
    }

    await this.resolution.resolve(
      parsed.data.token,
      parsed.data.resolutionId,
      request.ip ?? "0.0.0.0"
    );

    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return GENERIC_RESOLUTION_RESPONSE;
  }
}
