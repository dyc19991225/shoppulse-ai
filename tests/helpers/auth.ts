import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

/** Secret stubbed by route tests so sessions resolve without touching real env. */
export const TEST_SESSION_SECRET = 'route-test-session-secret';

/**
 * Builds a valid v2 session cookie for user 1, the bootstrap admin that every
 * migrated test database contains (session_version 0). Signed synchronously so
 * request helpers stay non-async; the format matches lib/auth/session.ts.
 */
export function adminSessionCookie(
  user: { id?: number; username?: string; ver?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.username ?? 'admin',
      uid: user.id ?? 1,
      ver: user.ver ?? 0,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TEST_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `shoppulse_session=${payload}.${signature}`;
}

/** NextRequest carrying the admin session cookie (relative URLs get localhost). */
export function authedRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
): NextRequest {
  return new NextRequest(/^https?:\/\//.test(url) ? url : `http://localhost${url}`, {
    ...init,
    headers: { cookie: adminSessionCookie(), ...init.headers },
  });
}
