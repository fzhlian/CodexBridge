import type { IdempotencyStore } from "@codexbridge/shared";
import {
  createMemoryIdempotencyStore,
  MemoryAuditIndexStore,
  MemoryInflightCommandStore,
  MemoryMachineStateStore
} from "./memory-stores.js";
import {
  RedisAuditIndexStore,
  RedisIdempotencyStore,
  RedisInflightCommandStore,
  RedisMachineStateStore
} from "./redis-stores.js";
import type {
  AuditIndexStore,
  InflightCommandStore,
  MachineStateStore,
  RelayStoreDiagnostics,
  RelayStores,
  StoreMode
} from "./store-types.js";

type Closeable = { close?: () => Promise<void> };
type Pingable = { ping?: () => Promise<void> };

export async function createRelayStoresFromEnv(): Promise<RelayStores> {
  const redisUrl = process.env.REDIS_URL;
  const explicitMode = parseStoreMode(process.env.STORE_MODE);
  const configuredMode: StoreMode = explicitMode ?? (redisUrl ? "redis" : "memory");
  const auditMode = parseStoreMode(process.env.AUDIT_INDEX_MODE) ?? configuredMode;
  const redisPrefix = process.env.REDIS_PREFIX ?? "codexbridge:";
  const redisConnectTimeoutMs = parsePositiveMs(process.env.REDIS_CONNECT_TIMEOUT_MS);

  const diagnostics: RelayStoreDiagnostics = {
    configuredMode,
    mode: configuredMode,
    degraded: false,
    redisErrorCount: 0
  };

  const memory = {
    idempotency: createMemoryIdempotencyStore(),
    machineState: new MemoryMachineStateStore(),
    inflight: new MemoryInflightCommandStore(),
    auditIndex: new MemoryAuditIndexStore()
  };

  if (configuredMode === "memory" || !redisUrl) {
    diagnostics.mode = "memory";
    return {
      ...memory,
      diagnostics,
      close: async () => {}
    };
  }

  let closeOnInitFailure: unknown[] = [];
  try {
    const redis = {
      idempotency: new RedisIdempotencyStore(
        redisUrl,
        `${redisPrefix}dedupe:`,
        redisConnectTimeoutMs
      ),
      machineState: new RedisMachineStateStore(redisUrl, redisPrefix, redisConnectTimeoutMs),
      inflight: new RedisInflightCommandStore(redisUrl, redisPrefix, redisConnectTimeoutMs),
      auditIndex:
        auditMode === "redis"
          ? new RedisAuditIndexStore(redisUrl, redisPrefix, redisConnectTimeoutMs)
          : memory.auditIndex
    };
    closeOnInitFailure = [redis.idempotency, redis.machineState, redis.inflight, redis.auditIndex];

    await Promise.all([
      ensureReady(redis.idempotency),
      ensureReady(redis.machineState),
      ensureReady(redis.inflight),
      auditMode === "redis" ? ensureReady(redis.auditIndex as Pingable) : Promise.resolve()
    ]);
    return {
      idempotency: withFallbackIdempotency(redis.idempotency, memory.idempotency, diagnostics),
      machineState: withFallbackMachineStore(redis.machineState, memory.machineState, diagnostics),
      inflight: withFallbackInflightStore(redis.inflight, memory.inflight, diagnostics),
      auditIndex: withFallbackAuditStore(redis.auditIndex, memory.auditIndex, diagnostics),
      diagnostics,
      close: async () => {
        await safeCloseMany(redis.idempotency, redis.machineState, redis.inflight, redis.auditIndex);
      }
    };
  } catch (error) {
    if (closeOnInitFailure.length > 0) {
      await safeCloseMany(...closeOnInitFailure);
    }
    diagnostics.mode = "memory";
    diagnostics.degraded = true;
    diagnostics.redisErrorCount += 1;
    diagnostics.lastRedisError = formatStoreError(error);
    return {
      ...memory,
      diagnostics,
      close: async () => {}
    };
  }
}

function parseStoreMode(raw?: string): StoreMode | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === "memory" || raw === "redis") {
    return raw;
  }
  return undefined;
}

function parsePositiveMs(raw?: string): number | undefined {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

async function ensureReady(target: Pingable): Promise<void> {
  if (typeof target.ping === "function") {
    await target.ping();
  }
}

function markRedisError(diagnostics: RelayStoreDiagnostics, error: unknown): void {
  diagnostics.degraded = true;
  diagnostics.mode = "memory";
  diagnostics.redisErrorCount += 1;
  diagnostics.lastRedisError = formatStoreError(error);
}

function formatStoreError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let delayMs = 80;
  let lastError: unknown;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < 2) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
        delayMs *= 2;
      }
    }
  }
  throw lastError;
}

function withFallbackIdempotency(
  primary: IdempotencyStore & Closeable,
  fallback: IdempotencyStore,
  diagnostics: RelayStoreDiagnostics
): IdempotencyStore & Closeable {
  return {
    async seen(key: string): Promise<boolean> {
      try {
        return await retry(() => primary.seen(key));
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.seen(key);
      }
    },
    async mark(key: string, ttlMs: number): Promise<void> {
      try {
        await retry(() => primary.mark(key, ttlMs));
        await fallback.mark(key, ttlMs);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.mark(key, ttlMs);
      }
    },
    close: async () => {
      if (typeof primary.close === "function") {
        await primary.close();
      }
    }
  };
}

function withFallbackMachineStore(
  primary: MachineStateStore,
  fallback: MachineStateStore,
  diagnostics: RelayStoreDiagnostics
): MachineStateStore {
  return {
    async register(record, ttlMs) {
      try {
        await retry(() => primary.register(record, ttlMs));
        await fallback.register(record, ttlMs);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.register(record, ttlMs);
      }
    },
    async markHeartbeat(machineId, timestampMs, ttlMs, metrics) {
      try {
        await retry(() => primary.markHeartbeat(machineId, timestampMs, ttlMs, metrics));
        await fallback.markHeartbeat(machineId, timestampMs, ttlMs, metrics);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.markHeartbeat(machineId, timestampMs, ttlMs, metrics);
      }
    },
    async remove(machineId) {
      try {
        await retry(() => primary.remove(machineId));
        await fallback.remove(machineId);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.remove(machineId);
      }
    },
    async get(machineId) {
      try {
        return await retry(() => primary.get(machineId));
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.get(machineId);
      }
    },
    async list() {
      try {
        return await retry(() => primary.list());
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.list();
      }
    }
  };
}

function withFallbackInflightStore(
  primary: InflightCommandStore,
  fallback: InflightCommandStore,
  diagnostics: RelayStoreDiagnostics
): InflightCommandStore {
  return {
    async set(record, ttlMs) {
      try {
        await retry(() => primary.set(record, ttlMs));
        await fallback.set(record, ttlMs);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.set(record, ttlMs);
      }
    },
    async get(commandId) {
      try {
        return await retry(() => primary.get(commandId));
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.get(commandId);
      }
    },
    async remove(commandId) {
      try {
        await retry(() => primary.remove(commandId));
        await fallback.remove(commandId);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.remove(commandId);
      }
    },
    async list() {
      try {
        return await retry(() => primary.list());
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.list();
      }
    }
  };
}

function withFallbackAuditStore(
  primary: AuditIndexStore,
  fallback: AuditIndexStore,
  diagnostics: RelayStoreDiagnostics
): AuditIndexStore {
  return {
    async applyEvent(event, maxRecords) {
      try {
        await retry(() => primary.applyEvent(event, maxRecords));
        await fallback.applyEvent(event, maxRecords);
      } catch (error) {
        markRedisError(diagnostics, error);
        await fallback.applyEvent(event, maxRecords);
      }
    },
    async get(commandId) {
      try {
        return await retry(() => primary.get(commandId));
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.get(commandId);
      }
    },
    async listRecent(limit, filter) {
      try {
        return await retry(() => primary.listRecent(limit, filter));
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.listRecent(limit, filter);
      }
    },
    async count() {
      try {
        return await retry(() => primary.count());
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.count();
      }
    },
    async statusCounts() {
      try {
        return await retry(() => primary.statusCounts());
      } catch (error) {
        markRedisError(diagnostics, error);
        return fallback.statusCounts();
      }
    }
  };
}

async function safeCloseMany(...items: unknown[]): Promise<void> {
  for (const item of items) {
    const maybe = item as Closeable;
    if (typeof maybe.close === "function") {
      try {
        await maybe.close();
      } catch {
        continue;
      }
    }
  }
}
