import { RateLimiter } from './ratelimit';

/**
 * Per-site widget rate limiters. Each site configures its own requests-per-
 * minute, so we cache one limiter per site key and rebuild it when the limit
 * changes (e.g. after the admin edits the site).
 */
interface CachedLimiter {
  limit: number;
  limiter: RateLimiter;
}

const limiters = new Map<string, CachedLimiter>();

export function checkWidgetRateLimit(
  siteKey: string,
  clientKey: string,
  limitPerMin: number,
): ReturnType<RateLimiter['check']> {
  const limit = Math.max(1, Math.floor(limitPerMin));
  let entry = limiters.get(siteKey);
  if (!entry || entry.limit !== limit) {
    entry = { limit, limiter: new RateLimiter({ limit, windowMs: 60_000 }) };
    limiters.set(siteKey, entry);
  }
  return entry.limiter.check(`${siteKey}:${clientKey}`);
}

/** Test helper. */
export function resetWidgetRateLimits(): void {
  limiters.clear();
}

/** Test helper: mutate the clock of a site's limiter. */
export function getWidgetLimiterForTesting(siteKey: string): RateLimiter | undefined {
  return limiters.get(siteKey)?.limiter;
}
