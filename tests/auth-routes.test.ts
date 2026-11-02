import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { hashPasswordSync, signSession } from '@/lib/auth';
import { resetDbCache } from '@/lib/db-runtime';
import { resetLoginLimiter } from '@/lib/ratelimit';
import { createTempDb, type TempDb } from './helpers/tempdb';

const PASSWORD = 'test-password-123';
const HASH = hashPasswordSync(PASSWORD);
const SECRET = 'test-session-secret';

let temp: TempDb | undefined;

function loginRequest(body: unknown, ip = '10.0.0.1'): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  temp = createTempDb();
  resetDbCache();
  resetLoginLimiter();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('ADMIN_USERNAME', 'admin');
  vi.stubEnv('ADMIN_PASSWORD_HASH', HASH);
  vi.stubEnv('ADMIN_PASSWORD', '');
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'test');
  // Tests simulate distinct clients via X-Forwarded-For, which is honoured
  // only when a trusted proxy is configured.
  vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginLimiter();
  resetDbCache();
  temp?.cleanup();
  temp = undefined;
});

describe('POST /api/auth/login', () => {
  it('signs in with valid credentials and sets an httpOnly cookie', async () => {
    const res = await loginPost(loginRequest({ username: 'admin', password: PASSWORD }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, username: 'admin' });

    const cookie = res.cookies.get('shoppulse_session');
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('rejects a wrong password and a wrong username', async () => {
    const wrongPassword = await loginPost(loginRequest({ username: 'admin', password: 'nope' }));
    expect(wrongPassword.status).toBe(401);
    expect((await wrongPassword.json()).error).toBe('invalid_credentials');

    const wrongUser = await loginPost(loginRequest({ username: 'root', password: PASSWORD }));
    expect(wrongUser.status).toBe(401);
  });

  it('rejects malformed bodies and missing credentials', async () => {
    const badJson = await loginPost(loginRequest('{not json'));
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error).toBe('invalid_json');

    const missing = await loginPost(loginRequest({ username: 'admin' }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe('missing_credentials');

    const wrongTypes = await loginPost(loginRequest({ username: 1, password: true }));
    expect(wrongTypes.status).toBe(400);
  });

  it('rate limits repeated failures per IP', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await loginPost(loginRequest({ username: 'admin', password: 'bad' }, '10.0.0.9'));
      expect(res.status).toBe(401);
    }

    const blocked = await loginPost(
      loginRequest({ username: 'admin', password: PASSWORD }, '10.0.0.9'),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // A different IP is unaffected.
    const otherIp = await loginPost(
      loginRequest({ username: 'admin', password: PASSWORD }, '10.0.0.10'),
    );
    expect(otherIp.status).toBe(200);
  });

  it('clears the failure budget after a successful login', async () => {
    for (let i = 0; i < 4; i += 1) {
      await loginPost(loginRequest({ username: 'admin', password: 'bad' }, '10.0.0.11'));
    }
    const success = await loginPost(
      loginRequest({ username: 'admin', password: PASSWORD }, '10.0.0.11'),
    );
    expect(success.status).toBe(200);

    for (let i = 0; i < 4; i += 1) {
      const res = await loginPost(
        loginRequest({ username: 'admin', password: 'bad' }, '10.0.0.11'),
      );
      expect(res.status).toBe(401);
    }
  });

  it('returns not_configured when no credentials are set', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    const res = await loginPost(loginRequest({ username: 'admin', password: 'x' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('not_configured');
  });

  it('supports the plaintext development password fallback', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', '');
    vi.stubEnv('ADMIN_PASSWORD', 'dev-pass');
    const res = await loginPost(loginRequest({ username: 'admin', password: 'dev-pass' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('expires the session cookie', async () => {
    const res = logoutPost();
    expect(res.status).toBe(200);
    const cookie = res.cookies.get('shoppulse_session');
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });
});

describe('session tokens issued by login', () => {
  it('are verifiable by the middleware verifier', async () => {
    const res = await loginPost(loginRequest({ username: 'admin', password: PASSWORD }));
    const token = res.cookies.get('shoppulse_session')!.value;
    const { verifySession } = await import('@/lib/auth/session');
    const result = await verifySession(token, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.sub).toBe('admin');
  });

  it('can be minted directly for middleware tests', async () => {
    const token = await signSession('admin', SECRET);
    expect(token.split('.')).toHaveLength(2);
  });
});
