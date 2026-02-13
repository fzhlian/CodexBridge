import { MemoryIdempotencyStore, type IdempotencyStore } from "@codexbridge/shared";
import { RedisIdempotencyStore } from "./redis-idempotency-store.js";

export function createIdempotencyStoreFromEnv(): IdempotencyStore & { close?: () => Promise<void> } {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new MemoryIdempotencyStore();
  }
  const prefix = process.env.REDIS_PREFIX ?? "codexbridge:dedupe:";
  return new RedisIdempotencyStore(redisUrl, prefix);
}

