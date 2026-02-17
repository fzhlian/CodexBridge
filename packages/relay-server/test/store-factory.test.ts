import type { IdempotencyStore } from "@codexbridge/shared";
import { describe, expect, it } from "vitest";
import {
  createMemoryIdempotencyStore,
  MemoryAuditIndexStore,
  MemoryInflightCommandStore,
  MemoryMachineStateStore
} from "../src/memory-stores.js";
import {
  createRelayStoresFromEnv,
  type RelayStoreFactoryOverrides
} from "../src/store-factory.js";
import type {
  AuditIndexStore,
  InflightCommandStore,
  MachineStateStore
} from "../src/store-types.js";

const STORE_ENV_KEYS = ["REDIS_URL", "STORE_MODE", "AUDIT_INDEX_MODE"] as const;
type StoreEnvKey = (typeof STORE_ENV_KEYS)[number];

describe("createRelayStoresFromEnv", () => {
  it("returns memory store mode when REDIS_URL is absent", async () => {
    await withStoreEnv({}, async () => {
      const stores = await createRelayStoresFromEnv();
      expect(stores.diagnostics.mode).toBe("memory");
      expect(typeof stores.idempotency.seen).toBe("function");
      expect(typeof stores.machineState.list).toBe("function");
      await stores.close();
    });
  });

  it("falls back to memory when redis initialization fails", async () => {
    await withStoreEnv({
      REDIS_URL: "invalid://redis",
      STORE_MODE: "redis"
    }, async () => {
      const stores = await createRelayStoresFromEnv();
      expect(stores.diagnostics.mode).toBe("memory");
      expect(stores.diagnostics.degraded).toBe(true);
      await stores.close();
    });
  }, 3000);

  it("satisfies store contract in redis mode with injected primary stores", async () => {
    await withStoreEnv({
      REDIS_URL: "redis://injected-primary",
      STORE_MODE: "redis",
      AUDIT_INDEX_MODE: "redis"
    }, async () => {
      const stores = await createRelayStoresFromEnv(createHealthyRedisOverrides());
      expect(stores.diagnostics.mode).toBe("redis");
      expect(stores.diagnostics.degraded).toBe(false);

      await stores.idempotency.mark("msg-1", 60_000);
      expect(await stores.idempotency.seen("msg-1")).toBe(true);

      await stores.machineState.register({
        machineId: "m1",
        connectedAt: 100,
        lastHeartbeatAt: 100,
        runningCount: 0,
        pendingCount: 0,
        sessionId: "s1"
      }, 60_000);
      await stores.machineState.markHeartbeat("m1", 200, 60_000, {
        runningCount: 1,
        pendingCount: 2
      });
      expect((await stores.machineState.get("m1"))?.lastHeartbeatAt).toBe(200);

      await stores.inflight.set({
        commandId: "c1",
        userId: "u1",
        machineId: "m1",
        kind: "patch",
        createdAtMs: 300
      }, 60_000);
      expect((await stores.inflight.get("c1"))?.machineId).toBe("m1");

      await stores.auditIndex.applyEvent({
        commandId: "c1",
        timestamp: "2026-02-17T00:00:00.000Z",
        status: "created",
        userId: "u1",
        machineId: "m1"
      }, 100);
      await stores.auditIndex.applyEvent({
        commandId: "c1",
        timestamp: "2026-02-17T00:00:01.000Z",
        status: "agent_ok",
        userId: "u1",
        machineId: "m1"
      }, 100);
      expect((await stores.auditIndex.get("c1"))?.status).toBe("agent_ok");
      expect((await stores.auditIndex.statusCounts()).agent_ok).toBe(1);

      await stores.close();
    });
  });

  it("falls back to memory during runtime redis failures and records diagnostics", async () => {
    await withStoreEnv({
      REDIS_URL: "redis://injected-failure",
      STORE_MODE: "redis",
      AUDIT_INDEX_MODE: "redis"
    }, async () => {
      const stores = await createRelayStoresFromEnv({
        createRedisIdempotency: () => createFailingIdempotencyStore("idempotency failure"),
        createRedisMachineState: () => createFailingMachineStore("machine failure"),
        createRedisInflight: () => createFailingInflightStore("inflight failure"),
        createRedisAuditIndex: () => createFailingAuditStore("audit failure")
      });

      await stores.idempotency.mark("msg-2", 60_000);
      expect(await stores.idempotency.seen("msg-2")).toBe(true);

      await stores.machineState.register({
        machineId: "m2",
        connectedAt: 1000,
        lastHeartbeatAt: 1000,
        runningCount: 0,
        pendingCount: 0,
        sessionId: "s2"
      }, 60_000);
      expect((await stores.machineState.get("m2"))?.sessionId).toBe("s2");

      await stores.inflight.set({
        commandId: "c2",
        userId: "u2",
        machineId: "m2",
        kind: "test",
        createdAtMs: 1000
      }, 60_000);
      expect((await stores.inflight.get("c2"))?.userId).toBe("u2");

      await stores.auditIndex.applyEvent({
        commandId: "c2",
        timestamp: "2026-02-17T00:01:00.000Z",
        status: "created",
        userId: "u2",
        machineId: "m2"
      }, 100);
      expect((await stores.auditIndex.get("c2"))?.status).toBe("created");

      expect(stores.diagnostics.degraded).toBe(true);
      expect(stores.diagnostics.mode).toBe("memory");
      expect(stores.diagnostics.redisErrorCount).toBeGreaterThanOrEqual(4);
      expect(stores.diagnostics.lastRedisError).toMatch(/failure/i);
      await stores.close();
    });
  }, 5000);
});

async function withStoreEnv(
  values: Partial<Record<StoreEnvKey, string>>,
  run: () => Promise<void>
): Promise<void> {
  const snapshot = new Map<StoreEnvKey, string | undefined>();
  for (const key of STORE_ENV_KEYS) {
    snapshot.set(key, process.env[key]);
    const next = values[key];
    if (typeof next === "string") {
      process.env[key] = next;
    } else {
      delete process.env[key];
    }
  }
  try {
    await run();
  } finally {
    for (const key of STORE_ENV_KEYS) {
      const prev = snapshot.get(key);
      if (typeof prev === "string") {
        process.env[key] = prev;
      } else {
        delete process.env[key];
      }
    }
  }
}

function createHealthyRedisOverrides(): RelayStoreFactoryOverrides {
  return {
    createRedisIdempotency: () => withPingAndClose(createMemoryIdempotencyStore()),
    createRedisMachineState: () => withPingAndClose(new MemoryMachineStateStore()),
    createRedisInflight: () => withPingAndClose(new MemoryInflightCommandStore()),
    createRedisAuditIndex: () => withPingAndClose(new MemoryAuditIndexStore())
  };
}

function withPingAndClose<T extends object>(
  target: T
): T & { ping: () => Promise<void>; close: () => Promise<void> } {
  return Object.assign(target, {
    ping: async () => {},
    close: async () => {}
  });
}

function createFailingIdempotencyStore(message: string): IdempotencyStore & {
  ping: () => Promise<void>;
  close: () => Promise<void>;
} {
  return {
    async seen() {
      throw new Error(message);
    },
    async mark() {
      throw new Error(message);
    },
    ping: async () => {},
    close: async () => {}
  };
}

function createFailingMachineStore(message: string): MachineStateStore & {
  ping: () => Promise<void>;
  close: () => Promise<void>;
} {
  return {
    async register() {
      throw new Error(message);
    },
    async markHeartbeat() {
      throw new Error(message);
    },
    async remove() {
      throw new Error(message);
    },
    async get() {
      throw new Error(message);
    },
    async list() {
      throw new Error(message);
    },
    ping: async () => {},
    close: async () => {}
  };
}

function createFailingInflightStore(message: string): InflightCommandStore & {
  ping: () => Promise<void>;
  close: () => Promise<void>;
} {
  return {
    async set() {
      throw new Error(message);
    },
    async get() {
      throw new Error(message);
    },
    async remove() {
      throw new Error(message);
    },
    async list() {
      throw new Error(message);
    },
    ping: async () => {},
    close: async () => {}
  };
}

function createFailingAuditStore(message: string): AuditIndexStore & {
  ping: () => Promise<void>;
  close: () => Promise<void>;
} {
  return {
    async applyEvent() {
      throw new Error(message);
    },
    async get() {
      throw new Error(message);
    },
    async listRecent() {
      throw new Error(message);
    },
    async count() {
      throw new Error(message);
    },
    async statusCounts() {
      throw new Error(message);
    },
    ping: async () => {},
    close: async () => {}
  };
}
