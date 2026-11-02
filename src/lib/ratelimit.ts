import { parseBool } from './env-bool';

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

/**
 * Client IP used as the rate-limit key.
 *
 * X-Forwarded-For is attacker-controlled unless a trusted reverse proxy sits in
 * front and appends the peer address. With SHOPPULSE_TRUST_PROXY=1 we take the
 * right-most hop (the one added by our proxy) and ignore everything the client
 * wrote before it. Without the flag we ignore forwarding headers entirely and
 * use only the server-controlled request address.
 */
export function clientIp(request: Request): string {
  if (parseBool(process.env.SHOPPULSE_TRUST_PROXY)) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
      const trusted = hops.at(-1);
      if (trusted) return trusted.slice(0, 64);
    }
    return 'unknown';
  }

  // NextRequest exposes the socket address; plain Requests in tests may not.
  const address = (request as { ip?: unknown }).ip;
  return typeof address === 'string' && address.trim() ? address.trim() : 'unknown';
}
