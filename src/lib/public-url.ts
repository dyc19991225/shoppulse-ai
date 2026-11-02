/**
 * Canonical public URL handling for embed snippets (AC6.1).
 *
 * Embed snippets must never embed a host supplied by an unauthenticated
 * client. `SHOPPULSE_PUBLIC_BASE_URL` wins when configured; otherwise proxied
 * headers are only trusted when SHOPPULSE_TRUST_PROXY is enabled, and the
 * final fallback is the server-built request URL (not a header).
 */

import { parseBool, type Env } from './env-bool';

const HOST_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:.]+\])(?::\d{1,5})?$/;

/** Normalizes an absolute http(s) base URL; returns null when invalid. */
export function normalizePublicBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

function lastHop(value: string | null): string {
  if (!value) return '';
  const hops = value
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? '';
}

/**
 * Builds an origin from the *right-most* X-Forwarded-Host / X-Forwarded-Proto
 * hops, i.e. the ones appended by our own reverse proxy. Returns null when the
 * values are missing or look like an injection attempt.
 */
export function trustedForwardedBaseUrl(headers: Headers): string | null {
  const host = lastHop(headers.get('x-forwarded-host'));
  if (!host || !HOST_RE.test(host)) return null;
  const proto = lastHop(headers.get('x-forwarded-proto')).toLowerCase();
  const scheme = proto === 'https' ? 'https' : proto === 'http' ? 'http' : null;
  if (!scheme) return null;
  return `${scheme}://${host}`;
}

export interface ResolveBaseUrlOptions {
  env?: Env;
  /** Injectable request URL origin; defaults to `request.url`. */
  requestUrl?: string;
}

/**
 * Resolves the base URL used in embed snippets:
 * 1. configured canonical `SHOPPULSE_PUBLIC_BASE_URL`;
 * 2. trusted proxy headers (only with `SHOPPULSE_TRUST_PROXY=1`);
 * 3. the request URL the Node server built (never `Host`/XFF headers).
 */
export function resolvePublicBaseUrl(
  headers: Headers,
  options: ResolveBaseUrlOptions = {},
): string {
  const env = options.env ?? process.env;
  const configured = normalizePublicBaseUrl(env.SHOPPULSE_PUBLIC_BASE_URL);
  if (configured) return configured;

  if (parseBool(env.SHOPPULSE_TRUST_PROXY)) {
    const forwarded = trustedForwardedBaseUrl(headers);
    if (forwarded) return forwarded;
  }

  const raw = options.requestUrl ?? 'http://localhost';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost';
  }
}
