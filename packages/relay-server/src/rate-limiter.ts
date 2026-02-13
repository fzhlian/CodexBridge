type Entry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Entry>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (current.count >= this.maxRequests) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

