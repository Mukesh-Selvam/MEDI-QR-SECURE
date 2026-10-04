import { ArgumentsHost, BadRequestException, Logger } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter.js";

describe("ApiExceptionFilter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a generic 500 with request ID and logs a redacted stack", () => {
    const logger = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { filter, host, response } = createFilterHost("request-123");

    filter.catch(
      new Error("Query failed for +919876543210; otp=123456", {
        cause: new Error('column "facility_id" does not exist'),
      }),
      host
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Internal server error",
      requestId: "request-123",
    });

    const logged = logger.mock.calls.flat().join("\n");
    expect(logged).toContain("request-123");
    expect(logged).toContain("Query failed");
    expect(logged).toContain('column "facility_id" does not exist');
    expect(logged).not.toContain("+919876543210");
    expect(logged).not.toContain("123456");
  });

  it("preserves expected Nest HTTP error responses", () => {
    const { filter, host, response } = createFilterHost("request-456");

    filter.catch(new BadRequestException("Invalid request"), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith({
      message: "Invalid request",
      error: "Bad Request",
      statusCode: 400,
    });
  });
});

function createFilterHost(requestId: string): {
  filter: ApiExceptionFilter;
  host: ArgumentsHost;
  response: { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
} {
  const response = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
  const filter = new ApiExceptionFilter();
  const request = { id: requestId } as FastifyRequest;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ArgumentsHost;

  return { filter, host, response };
}
