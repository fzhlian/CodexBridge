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
type IdempotencyPrimaryStore = IdempotencyStore & Closeable & Pingable;
type MachinePrimaryStore = MachineStateStore & Closeable & Pingable;
type InflightPrimaryStore = InflightCommandStore & Closeable & Pingable;
type AuditPrimaryStore = AuditIndexStore & Closeable & Pingable;

export type RelayStoreFactoryOverrides = {
  createRedisIdempotency?: (
    redisUrl: string,
    dedupePrefix: string,
    connectTimeoutMs?: number
  ) => IdempotencyPrimaryStore;
  createRedisMachineState?: (
    redisUrl: string,
    redisPrefix: string,
    connectTimeoutMs?: number
  ) => MachinePrimaryStore;
  createRedisInflight?: (
    redisUrl: string,
    redisPrefix: string,
    connectTimeoutMs?: number
  ) => InflightPrimaryStore;
  createRedisAuditIndex?: (
    redisUrl: string,
    redisPrefix: string,
    connectTimeoutMs?: number
  ) => AuditPrimaryStore;
};

const defaultFactoryOverrides: Required<RelayStoreFactoryOverrides> = {
  createRedisIdempotency: (redisUrl, dedupePrefix, connectTimeoutMs) =>
    new RedisIdempotencyStore(redisUrl, dedupePrefix, connectTimeoutMs),
  createRedisMachineState: (redisUrl, redisPrefix, connectTimeoutMs) =>
    new RedisMachineStateStore(redisUrl, redisPrefix, connectTimeoutMs),
  createRedisInflight: (redisUrl, redisPrefix, connectTimeoutMs) =>
    new RedisInflightCommandStore(redisUrl, redisPrefix, connectTimeoutMs),
  createRedisAuditIndex: (redisUrl, redisPrefix, connectTimeoutMs) =>
    new RedisAuditIndexStore(redisUrl, redisPrefix, connectTimeoutMs)
};

export async function createRelayStoresFromEnv(
  overrides: RelayStoreFactoryOverrides = {}
): Promise<RelayStores> {
  const redisUrl = process.env.REDIS_URL;
  const explicitMode = parseStoreMode(process.env.STORE_MODE);
  const configuredMode: StoreMode = explicitMode ?? (redisUrl ? "redis" : "memory");
  const auditMode = parseStoreMode(process.env.AUDIT_INDEX_MODE) ?? configuredMode;
  const redisPrefix = process.env.REDIS_PREFIX ?? "codexbridge:";
  const redisConnectTimeoutMs = parsePositiveMs(process.env.REDIS_CONNECT_TIMEOUT_MS);
  const redisInitTimeoutMs = parsePositiveMs(process.env.REDIS_INIT_TIMEOUT_MS) ?? 8_000;
  const redisCloseTimeoutMs = parsePositiveMs(process.env.REDIS_CLOSE_TIMEOUT_MS) ?? 1_500;
  const factories = {
    ...defaultFactoryOverrides,
    ...overrides
  };

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
      idempotency: factories.createRedisIdempotency(
        redisUrl,
        `${redisPrefix}dedupe:`,
        redisConnectTimeoutMs
      ),
      machineState: factories.createRedisMachineState(redisUrl, redisPrefix, redisConnectTimeoutMs),
      inflight: factories.createRedisInflight(redisUrl, redisPrefix, redisConnectTimeoutMs),
      auditIndex:
        auditMode === "redis"
          ? factories.createRedisAuditIndex(redisUrl, redisPrefix, redisConnectTimeoutMs)
          : memory.auditIndex
    };
    closeOnInitFailure = [redis.idempotency, redis.machineState, redis.inflight, redis.auditIndex];

    await Promise.all([
      ensureReady(redis.idempotency, redisInitTimeoutMs, "idempotency"),
      ensureReady(redis.machineState, redisInitTimeoutMs, "machineState"),
      ensureReady(redis.inflight, redisInitTimeoutMs, "inflight"),
      auditMode === "redis"
        ? ensureReady(redis.auditIndex as Pingable, redisInitTimeoutMs, "auditIndex")
        : Promise.resolve()
    ]);
    return {
      idempotency: withFallbackIdempotency(redis.idempotency, memory.idempotency, diagnostics),
      machineState: withFallbackMachineStore(redis.machineState, memory.machineState, diagnostics),
      inflight: withFallbackInflightStore(redis.inflight, memory.inflight, diagnostics),
      auditIndex: withFallbackAuditStore(redis.auditIndex, memory.auditIndex, diagnostics),
      diagnostics,
      close: async () => {
        await safeCloseMany(redisCloseTimeoutMs, redis.idempotency, redis.machineState, redis.inflight, redis.auditIndex);
      }
    };
  } catch (error) {
    if (closeOnInitFailure.length > 0) {
      await safeCloseMany(redisCloseTimeoutMs, ...closeOnInitFailure);
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

async function ensureReady(
  target: Pingable,
  timeoutMs: number,
  label: string
): Promise<void> {
  if (typeof target.ping === "function") {
    await withTimeout(
      target.ping(),
      timeoutMs,
      `redis ${label} init timeout after ${timeoutMs}ms`
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
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
  async function markFallbackIfUnseen(key: string, ttlMs: number): Promise<boolean> {
    if (typeof fallback.markIfUnseen === "function") {
      return fallback.markIfUnseen(key, ttlMs);
    }
    if (await fallback.seen(key)) {
      return false;
    }
    await fallback.mark(key, ttlMs);
    return true;
  }

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
    async markIfUnseen(key: string, ttlMs: number): Promise<boolean> {
      try {
        let reserved = false;
        const markIfUnseen = primary.markIfUnseen;
        if (typeof markIfUnseen === "function") {
          reserved = await retry(() => markIfUnseen.call(primary, key, ttlMs));
        } else {
          reserved = !await retry(() => primary.seen(key));
          if (reserved) {
            await retry(() => primary.mark(key, ttlMs));
          }
        }

        const fallbackReserved = await markFallbackIfUnseen(key, ttlMs);
        return reserved && fallbackReserved;
      } catch (error) {
        markRedisError(diagnostics, error);
        return markFallbackIfUnseen(key, ttlMs);
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

async function safeCloseMany(timeoutMs: number, ...items: unknown[]): Promise<void> {
  for (const item of items) {
    const maybe = item as Closeable;
    if (typeof maybe.close === "function") {
      try {
        await withTimeout(
          Promise.resolve().then(() => maybe.close?.()),
          timeoutMs,
          `redis close timeout after ${timeoutMs}ms`
        );
      } catch {
        continue;
      }
    }
  }
}
