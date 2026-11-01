/**
 * CORS for the public widget endpoints (AC6.3).
 *
 * Browsers always send `Origin`; non-browser clients (curl, server-side
 * checks) often do not. Missing Origin is allowed so health checks work, but a
 * present Origin must exactly match a configured origin. Wildcards are
 * deliberately unsupported.
 */

export interface CorsDecision {
  allowed: boolean;
  /** Headers to add to success and preflight responses. */
  headers: Record<string, string>;
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function checkCors(
  origin: string | null | undefined,
  allowedOrigins: readonly string[],
): CorsDecision {
  if (!origin) {
    // Same-origin GETs and non-browser clients.
    return { allowed: true, headers: {} };
  }

  const normalized = normalizeOrigin(origin);
  const allowed = allowedOrigins.some((entry) => normalizeOrigin(entry) === normalized);

  if (!allowed) return { allowed: false, headers: {} };

  return {
    allowed: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  };
}

/** Applies CORS headers to an existing Headers object. */
export function applyCors(headers: Headers, decision: CorsDecision): void {
  for (const [key, value] of Object.entries(decision.headers)) {
    headers.set(key, value);
  }
}
