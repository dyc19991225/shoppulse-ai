import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter, clientIp } from '@/lib/ratelimit';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeClock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('allows requests up to the limit then blocks', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: clock.now });

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    const third = limiter.check('a');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = limiter.check('a');
    expect(fourth.allowed).toBe(false);
    expect(fourth.limit).toBe(3);
  });

  it('isolates keys and resets when the window elapses', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: clock.now });

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);

    clock.advance(1001);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('supports cost and explicit reset', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
    expect(limiter.check('k', 3).allowed).toBe(true);
    expect(limiter.check('k', 3).allowed).toBe(false);
    limiter.reset('k');
    expect(limiter.check('k', 5).allowed).toBe(true);
  });

  it('sweeps expired buckets to bound memory', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 2, windowMs: 100, now: clock.now });
    limiter.check('a');
    limiter.check('b');
    expect(limiter.size).toBe(2);
    clock.advance(101);
    limiter.check('c');
    expect(limiter.size).toBe(1);
  });
});

describe('clientIp', () => {
  it('ignores X-Forwarded-For and X-Real-IP when no proxy is trusted', () => {
    const request = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' },
    });
    // Client-supplied headers must not be able to rotate the rate-limit key.
    expect(clientIp(request)).toBe('unknown');
  });

  it('uses the server-controlled request address when available', () => {
    const request = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    Object.defineProperty(request, 'ip', { value: '203.0.113.50' });
    expect(clientIp(request)).toBe('203.0.113.50');
  });

  it('uses the right-most X-Forwarded-For hop when the proxy is trusted', () => {
    vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
    const request = new Request('http://x', {
      headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' },
    });
    // The client-controlled left hop is ignored; Caddy appended the right one.
    expect(clientIp(request)).toBe('198.51.100.7');
  });

  it('accepts truthy spellings for SHOPPULSE_TRUST_PROXY', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      vi.stubEnv('SHOPPULSE_TRUST_PROXY', value);
      const request = new Request('http://x', {
        headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' },
      });
      expect(clientIp(request), value).toBe('198.51.100.7');
    }
  });

  it('falls back to unknown for a trusted proxy with no forwarding header', () => {
    vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
