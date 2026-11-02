import { RateLimiter } from './ratelimit';

/**
 * Per-site widget rate limiters. Each site configures its own requests-per-
 * minute, so we cache one limiter per site key and rebuild it when the limit
 * changes (e.g. after the admin edits the site).
 */
interface CachedLimiter {
  limit: number;
  limiter: RateLimiter;
  /** Last time this site's limiter was used (epoch ms). */
  lastUsed: number;
}

const limiters = new Map<string, CachedLimiter>();

/** Idle per-site limiters are evicted after this long. */
const IDLE_TTL_MS = 10 * 60_000;
const MAX_LIMITERS = 100;
let lastSweep = 0;

export function checkWidgetRateLimit(
  siteKey: string,
  clientKey: string,
  limitPerMin: number,
  now = Date.now(),
): ReturnType<RateLimiter['check']> {
  sweep(now);
  const limit = Math.max(1, Math.floor(limitPerMin));
  let entry = limiters.get(siteKey);
  if (!entry || entry.limit !== limit) {
    entry = { limit, limiter: new RateLimiter({ limit, windowMs: 60_000 }), lastUsed: now };
    limiters.set(siteKey, entry);
  }
  entry.lastUsed = now;
  return entry.limiter.check(`${siteKey}:${clientKey}`);
}

/**
 * Evicts limiters for sites that were deleted or have been idle for a while.
 * Bounding the map keeps memory flat even if site keys are created and removed
 * repeatedly (AC10.3).
 */
function sweep(now: number): void {
  if (now - lastSweep < 60_000 && limiters.size <= MAX_LIMITERS) return;
  lastSweep = now;
  for (const [key, entry] of limiters) {
    if (now - entry.lastUsed >= IDLE_TTL_MS) limiters.delete(key);
  }
  // Hard floor: leave room for the site about to be checked, so a burst of
  // distinct site keys cannot grow the map without bound.
  while (limiters.size >= MAX_LIMITERS) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, entry] of limiters) {
      if (entry.lastUsed < oldest) {
        oldest = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    limiters.delete(oldestKey);
  }
}

/** Drops a site's limiter immediately (e.g. when the site is deleted). */
export function forgetWidgetRateLimit(siteKey: string): void {
  limiters.delete(siteKey);
}

/** Test helper: number of cached site limiters. */
export function widgetRateLimiterCount(): number {
  return limiters.size;
}

/** Test helper. */
export function resetWidgetRateLimits(): void {
  limiters.clear();
  lastSweep = 0;
}

/** Test helper: mutate the clock of a site's limiter. */
export function getWidgetLimiterForTesting(siteKey: string): RateLimiter | undefined {
  return limiters.get(siteKey)?.limiter;
}
