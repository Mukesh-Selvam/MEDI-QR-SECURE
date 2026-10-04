import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

function renderError(exception: unknown, seen = new Set<unknown>()): string {
  if (!(exception instanceof Error)) return String(exception);
  if (seen.has(exception)) return "[cyclic error cause]";
  seen.add(exception);

  const stack = exception.stack ?? `${exception.name}: ${exception.message}`;
  const cause = exception.cause;
  return cause === undefined
    ? stack
    : `${stack}\nCaused by: ${renderError(cause, seen)}`;
}

function safeErrorStack(exception: unknown): string {
  const stack = renderError(exception);

  return stack
    .replace(/\bparams:\s*[^\r\n]*/gi, "params: [REDACTED]")
    .replace(/\+\d{8,15}\b/g, "[REDACTED_PHONE]")
    .replace(/(\botp(?:\s*(?:=|:|is)\s*)?)\d{4,8}\b/gi, "$1[REDACTED]");
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    if (
      exception instanceof HttpException &&
      exception.getStatus() < 500
    ) {
      reply.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const requestId = request.id ?? "unknown";
    this.logger.error(
      `Unhandled API exception (requestId=${requestId})`,
      safeErrorStack(exception)
    );

    reply.status(500).send({
      statusCode: 500,
      message: "Internal server error",
      requestId,
    });
  }
}
