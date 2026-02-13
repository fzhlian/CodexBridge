import { describe, expect, it } from "vitest";
import { createIdempotencyStoreFromEnv } from "../src/store-factory.js";

describe("createIdempotencyStoreFromEnv", () => {
  it("returns memory store when REDIS_URL is absent", () => {
    const original = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      const store = createIdempotencyStoreFromEnv();
      expect(typeof store.seen).toBe("function");
      expect(typeof store.mark).toBe("function");
    } finally {
      if (original) {
        process.env.REDIS_URL = original;
      }
    }
  });
});

