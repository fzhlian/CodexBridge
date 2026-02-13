import { createClient, type RedisClientType } from "redis";
import type { IdempotencyStore } from "@codexbridge/shared";

export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<void>;

  constructor(
    redisUrl: string,
    private readonly keyPrefix = "codexbridge:dedupe:"
  ) {
    this.client = createClient({ url: redisUrl });
  }

  async seen(key: string): Promise<boolean> {
    await this.ensureConnected();
    const value = await this.client.get(this.fullKey(key));
    return value === "1";
  }

  async mark(key: string, ttlMs: number): Promise<void> {
    await this.ensureConnected();
    await this.client.set(this.fullKey(key), "1", { PX: Math.max(1, ttlMs) });
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

