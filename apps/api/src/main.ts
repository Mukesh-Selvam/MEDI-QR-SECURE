import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env.NODE_ENV !== "production",
    }),
  );

  // Security & CORS
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim());

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

  const port = Number(process.env.PORT_API) || 3001;
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
