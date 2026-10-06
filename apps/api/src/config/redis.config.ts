import { Logger } from "@nestjs/common";
import { Redis, type RedisOptions } from "ioredis";
import type { RedisOptions as BullMqRedisOptions } from "bullmq";
import { env, type Env } from "./env.js";

type RedisEnvironment = Pick<Env, "REDIS_HOST" | "REDIS_PORT" | "REDIS_PASSWORD">;

const logger = new Logger("Redis");

export function createRedisOutageWarningHandlers(warn: () => void) {
  let outageWarningLogged = false;
  return {
    onError() {
      if (outageWarningLogged) return;
      outageWarningLogged = true;
      warn();
    },
    onReady() {
      outageWarningLogged = false;
    },
  };
}

export function getRedisConnectionOptions(
  config: RedisEnvironment = env
): BullMqRedisOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
  };
}

export function createRedisClient(options: RedisOptions = {}): Redis {
  const client = new Redis({ ...getRedisConnectionOptions(), ...options });
  const outageHandlers = createRedisOutageWarningHandlers(() => {
    logger.warn("Redis client reported a connection error.");
  });
  client.on("error", outageHandlers.onError);
  client.on("ready", outageHandlers.onReady);
  return client;
}
