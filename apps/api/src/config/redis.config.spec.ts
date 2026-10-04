import { describe, expect, it } from "vitest";
import { getRedisConnectionOptions } from "./redis.config.js";

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
});
