export interface IdempotencyStore {
  seen(key: string): Promise<boolean>;
  mark(key: string, ttlMs: number): Promise<void>;
  markIfUnseen?(key: string, ttlMs: number): Promise<boolean>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, number>();

  async seen(key: string): Promise<boolean> {
    this.cleanupExpired();
    const expiry = this.entries.get(key);
    return typeof expiry === "number" && expiry > Date.now();
  }

  async mark(key: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + Math.max(1, ttlMs);
    this.entries.set(key, expiresAt);
    this.cleanupExpired();
  }

  async markIfUnseen(key: string, ttlMs: number): Promise<boolean> {
    this.cleanupExpired();
    const now = Date.now();
    const expiry = this.entries.get(key);
    if (typeof expiry === "number" && expiry > now) {
      return false;
    }
    this.entries.set(key, now + Math.max(1, ttlMs));
    this.cleanupExpired();
    return true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, expiry] of this.entries.entries()) {
      if (expiry <= now) {
        this.entries.delete(key);
      }
    }
  }
}
