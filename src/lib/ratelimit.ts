/**
 * In-memory fixed-window rate limiter. Suitable for a single Node process
 * (the production deployment is one instance).
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  limit: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(options: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = Math.max(1, options.limit);
    this.windowMs = Math.max(1, options.windowMs);
    this.now = options.now ?? Date.now;
  }

  check(key: string, cost = 1): RateLimitResult {
    const now = this.now();
    this.maybeSweep(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += cost;
    const allowed = bucket.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
      limit: this.limit,
    };
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Drops expired buckets at most once per window to bound memory. */
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** Per-process limiters, reset in tests via the exported helpers. */
let loginLimiter: RateLimiter | null = null;

export function getLoginLimiter(): RateLimiter {
  if (!loginLimiter) loginLimiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
  return loginLimiter;
}

export function resetLoginLimiter(): void {
  loginLimiter = null;
}

/** Best-effort client IP from proxy headers, falling back to "unknown". */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
