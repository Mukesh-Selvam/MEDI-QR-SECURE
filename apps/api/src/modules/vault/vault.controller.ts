/**
 * VaultController
 * ===============
 * REST endpoints for the Records Vault:
 *   POST   /api/v1/vault/upload              — Upload a document (patient or facility staff)
 *   GET    /api/v1/vault/timeline/:patientId — Patient document timeline grouped by type
 *   GET    /api/v1/vault/:id/view-url        — Get a 5-minute presigned view URL
 *   GET    /api/v1/vault/:id/status          — Check document scan status
 *
 * All routes require @RequirePolicy() (deny-by-default via PolicyGuard).
 * No document contents, filenames, or patient identifiers are logged.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { VaultService, type DocumentType, type UploadSource } from "./vault.service.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { createHash } from "crypto";

@Controller("vault")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  /**
   * POST /api/v1/vault/upload
   * Upload a document. Multipart form-data with fields:
   *   - file: <binary>        — required
   *   - documentType: string  — required (scan | lab | prescription | vaccination | discharge)
   *   - patientId: string     — required (UUID of the patient record)
   *   - uploadSource: string  — required (patient-uploaded | facility-verified)
   *   - documentDate: string  — optional (ISO 8601 date for clinical date)
   *   - notes: string         — optional (must not contain patient identifiers)
   */
  @Post("upload")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePolicy({ resource: "document", action: "create" })
  async uploadDocument(
    @Req() req: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ id: string; status: string; message: string }> {
    // Parse multipart
    const data = await req.file();
    if (!data) throw new BadRequestException("No file attached to request");

    const fileBuffer = await data.toBuffer();
    const fields = data.fields as Record<string, { value: string } | undefined>;

    const documentType = (fields["documentType"]?.value ?? "") as DocumentType;
    const patientId = fields["patientId"]?.value ?? "";
    const uploadSource = (fields["uploadSource"]?.value ?? "patient-uploaded") as UploadSource;
    const documentDateStr = fields["documentDate"]?.value;
    const notes = fields["notes"]?.value;

    const VALID_TYPES = ["scan", "lab", "prescription", "vaccination", "discharge"];
    if (!VALID_TYPES.includes(documentType)) {
      throw new BadRequestException(`Invalid documentType: ${documentType}`);
    }
    if (!patientId) throw new BadRequestException("patientId is required");

    const ipHash = createHash("sha256")
      .update(req.ip ?? "0.0.0.0")
      .digest("hex");

    const result = await this.vaultService.uploadDocument({
      fileBuffer,
      declaredMimeType: data.mimetype,
      documentType,
      patientId,
      uploaderId: user.id,
      uploadSource,
      documentDate: documentDateStr ? new Date(documentDateStr) : undefined,
      notes,
      ipHash,
    });

    return {
      id: result.id,
      status: result.status,
      message:
        "Document staged for virus scanning. It will become available once the scan completes.",
    };
  }

  /**
   * GET /api/v1/vault/timeline/:patientId
   * Returns patient's document timeline grouped by type, sorted by date.
   */
  @Get("timeline/:patientId")
  @RequirePolicy({ resource: "document", action: "read" })
  async getTimeline(
    @Param("patientId", ParseUUIDPipe) patientId: string,
  ) {
    return this.vaultService.getTimeline(patientId);
  }

  /**
   * GET /api/v1/vault/:id/view-url
   * Returns a 5-minute presigned GET URL for viewing an encrypted document.
   * Audit event is written before returning the URL.
   */
  @Get(":id/view-url")
  @RequirePolicy({ resource: "document", action: "read" })
  async getViewUrl(
    @Param("id", ParseUUIDPipe) documentId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ url: string; expiresAt: string; sourceLabel: string; expiresInSeconds: number }> {
    const ipHash = createHash("sha256")
      .update(req.ip ?? "0.0.0.0")
      .digest("hex");

    const result = await this.vaultService.generateViewUrl(
      documentId,
      user.id,
      user.role,
      ipHash,
    );

    return {
      url: result.url,
      expiresAt: result.expiresAt.toISOString(),
      sourceLabel: result.sourceLabel,
      expiresInSeconds: 300,
    };
  }

  /**
   * GET /api/v1/vault/:id/status
   * Returns the current scan/availability status of a document.
   */
  @Get(":id/status")
  @RequirePolicy({ resource: "document", action: "read" })
  async getDocumentStatus(
    @Param("id", ParseUUIDPipe) documentId: string,
  ): Promise<{ id: string; status: string; scanStatus: string } | null> {
    const doc = await this.vaultService.findById(documentId);
    if (!doc) return null;
    return {
      id: documentId,
      status: doc.status,
      scanStatus: (doc as unknown as { scanStatus?: string }).scanStatus ?? "pending",
    };
  }

  /**
   * GET /api/v1/vault/:id/stream
   * In-browser zero-footprint viewer:
   * Streams decrypted content directly to the viewer with headers preventing caching:
   *   Cache-Control: no-store, no-cache, must-revalidate, private
   *   Pragma: no-cache
   *   Expires: 0
   * Document is never stored in browser cache or localStorage.
   * Access requires policy authorization; audit log entry recorded on every view.
   */
  @Get(":id/stream")
  @RequirePolicy({ resource: "document", action: "read" })
  async streamDocument(
    @Param("id", ParseUUIDPipe) documentId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Buffer> {
    const ipHash = createHash("sha256")
      .update(req.ip ?? "0.0.0.0")
      .digest("hex");

    const query = req.query as { purpose?: string } | undefined;
    const purpose = query?.purpose ?? "clinical-care";

    const { buffer, mimeType, sourceLabel } = await this.vaultService.getDecryptedDocument(
      documentId,
      user.id,
      user.role,
      ipHash,
      purpose,
    );

    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", 'inline; filename="document"');
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Source-Label", sourceLabel);

    return buffer;
  }
}

