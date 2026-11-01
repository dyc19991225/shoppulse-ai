import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/auth/session';

const SECRET = 'middleware-test-secret';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie: `shoppulse_session=${cookie}` } : {},
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware', () => {
  it('redirects unauthenticated admin pages to /login with next=', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const res = await middleware(request('/admin/products?page=2'));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/admin/products?page=2');
  });

  it('returns 401 JSON for unauthenticated admin APIs', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const res = await middleware(request('/api/admin/knowledge'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('passes through with a valid session', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const token = await signSession('admin', SECRET);
    const res = await middleware(request('/admin', token));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('rejects an invalid signature and clears the cookie', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const res = await middleware(request('/admin', 'forged.token'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    // Deleting a cookie emits Set-Cookie with an empty value/past expiry.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('shoppulse_session=');
    expect(res.cookies.get('shoppulse_session')?.value).toBe('');
  });

  it('rejects sessions signed with another secret', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const token = await signSession('admin', 'a-different-secret');
    const res = await middleware(request('/api/admin/stats', token));
    expect(res.status).toBe(401);
  });

  it('does not redirect when no secret is configured but denies access', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    const res = await middleware(request('/admin'));
    expect(res.status).toBe(307);
  });
});
