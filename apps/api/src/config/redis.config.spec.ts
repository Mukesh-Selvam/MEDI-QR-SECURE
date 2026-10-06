import { describe, expect, it, vi } from "vitest";
import {
  createRedisOutageWarningHandlers,
  getRedisConnectionOptions,
} from "./redis.config.js";

describe("Redis connection configuration", () => {
  it("passes passwords directly as client options, never through a URL", () => {
    const options = getRedisConnectionOptions({
      REDIS_HOST: "redis.test.invalid",
      REDIS_PORT: 6379,
      REDIS_PASSWORD: "reserved:@/?#[]%characters",
    });

    expect(options).toEqual({
      host: "redis.test.invalid",
      port: 6379,
      password: "reserved:@/?#[]%characters",
    });
    expect(options).not.toHaveProperty("url");
  });

  it("logs once during a Redis outage and resets after recovery", () => {
    const warn = vi.fn();
    const handlers = createRedisOutageWarningHandlers(warn);

    handlers.onError();
    handlers.onError();
    handlers.onError();
    expect(warn).toHaveBeenCalledTimes(1);

    handlers.onReady();
    handlers.onError();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
