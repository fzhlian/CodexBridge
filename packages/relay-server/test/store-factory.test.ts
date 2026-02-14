import { describe, expect, it } from "vitest";
import { createRelayStoresFromEnv } from "../src/store-factory.js";

describe("createRelayStoresFromEnv", () => {
  it("returns memory store mode when REDIS_URL is absent", async () => {
    const original = process.env.REDIS_URL;
    const originalMode = process.env.STORE_MODE;
    try {
      delete process.env.REDIS_URL;
      delete process.env.STORE_MODE;
      const stores = await createRelayStoresFromEnv();
      expect(stores.diagnostics.mode).toBe("memory");
      expect(typeof stores.idempotency.seen).toBe("function");
      expect(typeof stores.machineState.list).toBe("function");
      await stores.close();
    } finally {
      if (original) {
        process.env.REDIS_URL = original;
      } else {
        delete process.env.REDIS_URL;
      }
      if (originalMode) {
        process.env.STORE_MODE = originalMode;
      } else {
        delete process.env.STORE_MODE;
      }
    }
  });

  it("falls back to memory when redis initialization fails", async () => {
    const original = process.env.REDIS_URL;
    const originalMode = process.env.STORE_MODE;
    try {
      process.env.REDIS_URL = "invalid://redis";
      process.env.STORE_MODE = "redis";
      const stores = await createRelayStoresFromEnv();
      expect(stores.diagnostics.mode).toBe("memory");
      expect(stores.diagnostics.degraded).toBe(true);
      await stores.close();
    } finally {
      if (original) {
        process.env.REDIS_URL = original;
      } else {
        delete process.env.REDIS_URL;
      }
      if (originalMode) {
        process.env.STORE_MODE = originalMode;
      } else {
        delete process.env.STORE_MODE;
      }
    }
  }, 3000);
});
