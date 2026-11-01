import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  hashPasswordSync,
  safeEqual,
  sessionCookieOptions,
  signSession,
  verifyPassword,
  verifySession,
} from '@/lib/auth';

describe('password hashing', () => {
  it('produces salt:hash pairs and verifies them', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('uses a fresh salt each time', () => {
    const a = hashPasswordSync('same');
    const b = hashPasswordSync('same');
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a)).toBe(true);
    expect(verifyPassword('same', b)).toBe(true);
  });

  it('rejects malformed or empty stored hashes without throwing', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'nocolon')).toBe(false);
    expect(verifyPassword('x', 'zz:zz')).toBe(false);
    expect(verifyPassword('x', ':')).toBe(false);
    expect(verifyPassword('', hashPasswordSync('x'))).toBe(false);
  });

  it('rejects empty passwords when hashing', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    expect(() => hashPasswordSync('')).toThrow();
  });

  it('safeEqual compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('sessions', () => {
  const secret = 'test-session-secret';

  it('signs and verifies a session with subject and expiry', async () => {
    const token = await signSession('admin', secret, { now: 1_000, ttlSeconds: 600 });
    const result = await verifySession(token, secret, { now: 1_100 });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('admin');
      expect(result.payload.iat).toBe(1000);
      expect(result.payload.exp).toBe(1600);
    }
  });

  it('rejects an expired session', async () => {
    const token = await signSession('admin', secret, { now: 1_000, ttlSeconds: 10 });
    const result = await verifySession(token, secret, { now: 1_011 });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects tokens signed with another secret', async () => {
    const token = await signSession('admin', 'other-secret');
    expect(await verifySession(token, secret)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload', async () => {
    const token = await signSession('admin', secret);
    const [payload, signature] = token.split('.');
    const forged = `${payload.slice(0, -2)}${payload.slice(-2) === 'AA' ? 'BB' : 'AA'}.${signature}`;
    const result = await verifySession(forged, secret);
    expect(result.valid).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    for (const token of ['', 'onlyonepart', '.abc', 'abc.', 'a.b.c', '!!!.???']) {
      const result = await verifySession(token, secret);
      expect(result.valid).toBe(false);
    }
  });

  it('requires a secret to sign', async () => {
    await expect(signSession('admin', '')).rejects.toThrow();
  });

  it('builds httpOnly lax cookie options, secure in production', () => {
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
