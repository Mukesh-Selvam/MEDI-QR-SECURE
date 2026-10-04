/**
 * API Bootstrap
 *
 * IMPORTANT: env.ts MUST be the first import. It loads the .env file from the
 * monorepo root (CWD-independent) and validates all required variables before
 * any other module touches process.env.
 */
import "./config/env.js"; // ← side-effect: loads .env + validates; process.exit(1) on failure
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { Logger } from "@nestjs/common";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter.js";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import { env } from "./config/env.js";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: env.NODE_ENV !== "production",
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  // Register cookie support
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCookie as any, {
    secret: env.SESSION_SECRET,
  });

  // Register multipart/form-data support for document uploads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyMultipart as any, {
    limits: {
      fileSize: env.MAX_UPLOAD_SIZE_BYTES, // default 10 MB
      files: 1,                            // single file per request
    },
    attachFieldsToBody: false,
  });

  // Security & CORS
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((o) =>
    o.trim()
  );

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Global Prefix
  app.setGlobalPrefix("api/v1", {
    exclude: ["health", "health/ready"],
  });

  // OpenAPI / Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle("MediQR Secure API")
    .setDescription(
      "India-First Digital Health-Record Access Platform for Maternal & Child Healthcare. " +
        "Assistive, strictly non-diagnostic. Opaque QR token authorization with tamper-evident audit trail.",
    )
    .setVersion("1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Keycloak OIDC Access Token",
      },
      "bearer-jwt",
    )
    .addTag("Health", "Liveness and readiness checks")
    .addTag("Access", "Opaque QR token resolution and access authorization")
    .addTag("Consent", "Patient/guardian consent management and revocation")
    .addTag("Emergency", "Break-glass emergency summary access")
    .addTag("Audit", "Tamper-evident audit chain exploration")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = env.PORT_API;
  const host = "0.0.0.0";

  await app.listen(port, host);
  logger.log(`MediQR API running at http://${host}:${port}`);
  logger.log(
    `OpenAPI documentation available at http://${host}:${port}/api/docs`,
  );
  logger.log(`Health endpoint: http://${host}:${port}/health`);
}

bootstrap().catch((err) => {
  console.error("Fatal error during API bootstrap:", err);
  process.exit(1);
});
