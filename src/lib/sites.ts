import { randomBytes } from 'node:crypto';
import { normalizeOrigin } from './cors';

/**
 * Site (widget installation) helpers: site-key generation, origin validation
 * and the embed snippet shown in the admin UI (AC6.1).
 */

export const MAX_SITES = 20;
export const MAX_ORIGINS = 20;
export const MIN_RATE_LIMIT = 1;
export const MAX_RATE_LIMIT = 600;

/** URL-safe public key; 14 hex chars keeps the embed snippet short. */
export function generateSiteKey(): string {
  return randomBytes(7).toString('hex');
}

export function isValidSiteKey(value: string): boolean {
  return /^[a-zA-Z0-9_-]{6,64}$/.test(value);
}

/** Normalizes and validates an origin list. Returns null on any invalid entry. */
export function parseOrigins(value: unknown): string[] | null {
  let entries: string[];
  if (typeof value === 'string') {
    entries = value.split(/[\n,]+/);
  } else if (Array.isArray(value)) {
    if (value.some((entry) => typeof entry !== 'string')) return null;
    entries = value as string[];
  } else {
    return null;
  }

  const origins: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed === '*') return null;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    origins.push(normalizeOrigin(trimmed));
  }

  const unique = [...new Set(origins)];
  return unique.length <= MAX_ORIGINS ? unique : null;
}

export function isAllowedRateLimit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RATE_LIMIT &&
    value <= MAX_RATE_LIMIT
  );
}

/**
 * Builds the copy-paste embed snippet. `siteUrl` is the ShopPulse deployment
 * origin (not the merchant's site); defaults to a placeholder when unknown.
 */
export function embedSnippet(siteKey: string, siteUrl = 'https://YOUR-DOMAIN'): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `<script src="${base}/widget.js" data-site-key="${siteKey}" async></script>`;
}

/** Extracts the request origin for snippet generation (first proxy hop wins). */
export function requestBaseUrl(request: Request): string {
  const first = (value: string | null): string => (value ?? '').split(',')[0].trim();
  const forwardedProto = first(request.headers.get('x-forwarded-proto'));
  const forwardedHost = first(request.headers.get('x-forwarded-host')) ||
    first(request.headers.get('host'));
  if (forwardedHost) {
    const proto = forwardedProto === 'https' ? 'https' : 'http';
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
