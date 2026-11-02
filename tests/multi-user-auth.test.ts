import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { GET as statsRoute } from '@/app/api/admin/stats/route';
import {
  getCurrentUser,
  getSessionUser,
  isAuthConfigured,
  requireAdminApi,
  resolveSessionUser,
  sessionOptionsFor,
  signSession,
  verifyUserCredentials,
} from '@/lib/auth';
import {
  ensureEnvAdmin,
  getUserById,
  getUserByUsername,
  type DB,
} from '@/lib/db';
import * as passwordModule from '@/lib/auth/password';
import { hashPasswordSync } from '@/lib/auth/password';
import { getDb, resetDbCache } from '@/lib/db-runtime';
import { resetLoginLimiter } from '@/lib/ratelimit';
import { createTempDb, type TempDb } from './helpers/tempdb';

const ENV_PASSWORD = 'env-admin-password';
const ENV_HASH = hashPasswordSync(ENV_PASSWORD);
const SECRET = 'multi-user-test-secret';
const USER_PASSWORD = 'db-user-password';
const USER_HASH = hashPasswordSync(USER_PASSWORD);

let temp: TempDb | undefined;

function db(): DB {
  return temp!.db;
}

/** Inserts a non-bootstrap user (id 1 is created by the migration). */
function createUser(
  username: string,
  options: { passwordHash?: string; disabled?: boolean; role?: 'admin' | 'user' } = {},
): number {
  const info = db()
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(
      username,
      options.passwordHash ?? '',
      options.role ?? 'user',
      options.disabled ? 1 : 0,
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

function config(overrides: Partial<{ username: string; passwordHash: string; password: string }> = {}) {
  return {
    admin: {
      username: 'admin',
      passwordHash: ENV_HASH,
      password: '',
      ...overrides,
    },
  };
}

function loginRequest(body: unknown, ip = '10.1.0.1'): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function sessionRequest(token: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/stats', {
    headers: { cookie: `shoppulse_session=${token}` },
  });
}

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('ADMIN_USERNAME', 'admin');
  vi.stubEnv('ADMIN_PASSWORD_HASH', ENV_HASH);
  vi.stubEnv('ADMIN_PASSWORD', '');
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
  resetDbCache();
  resetLoginLimiter();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginLimiter();
  resetDbCache();
  temp?.cleanup();
  temp = undefined;
});

describe('users table bootstrap', () => {
  it('starts with user 1 as the admin and no other users', () => {
    const [admin] = db().prepare('SELECT * FROM users').all() as {
      id: number;
      username: string;
      password_hash: string;
      role: string;
    }[];

    expect(admin).toMatchObject({ id: 1, username: 'admin', role: 'admin' });
    expect(admin.password_hash).toBe('');
    expect(getUserByUsername(db(), 'ADMIN')!.id).toBe(1);
  });

  it('renames user 1 when ADMIN_USERNAME changes and no other user has that name', () => {
    ensureEnvAdmin(db(), config({ username: 'owner' }));
    expect(getUserById(db(), 1)!.username).toBe('owner');
    // Case-insensitive lookup follows the new name.
    expect(getUserByUsername(db(), 'Owner')!.id).toBe(1);
  });

  it('does not rename user 1 once it has its own password', () => {
    db().prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(USER_HASH);
    ensureEnvAdmin(db(), config({ username: 'owner' }));
    expect(getUserById(db(), 1)!.username).toBe('admin');
  });

  it('never steals a username that another user already has', () => {
    createUser('owner', { passwordHash: USER_HASH });
    ensureEnvAdmin(db(), config({ username: 'owner' }));

    expect(getUserById(db(), 1)!.username).toBe('admin');
    expect(getUserByUsername(db(), 'owner')!.id).toBe(2);
  });

  it('is idempotent', () => {
    ensureEnvAdmin(db(), config({ username: 'owner' }));
    ensureEnvAdmin(db(), config({ username: 'owner' }));
    expect(getUserById(db(), 1)!.username).toBe('owner');
    expect(getUserByUsername(db(), 'admin')).toBeNull();
  });

  it('runs on getDb() so a renamed env admin is applied at runtime', () => {
    vi.stubEnv('ADMIN_USERNAME', 'boss');
    resetDbCache();
    expect(getDb().prepare('SELECT username FROM users WHERE id = 1').get()).toEqual({
      username: 'boss',
    });
  });
});

describe('verifyUserCredentials', () => {
  it('accepts a DB user with a stored hash and rejects a wrong password', () => {
    createUser('friend', { passwordHash: USER_HASH });

    expect(verifyUserCredentials(db(), 'friend', USER_PASSWORD, config()).ok).toBe(true);
    expect(verifyUserCredentials(db(), 'friend', 'wrong', config()).ok).toBe(false);
    expect(verifyUserCredentials(db(), 'nobody', USER_PASSWORD, config()).ok).toBe(false);
  });

  it('looks usernames up case-insensitively', () => {
    createUser('Friend', { passwordHash: USER_HASH });
    expect(verifyUserCredentials(db(), 'friend', USER_PASSWORD, config()).ok).toBe(true);
    expect(verifyUserCredentials(db(), 'FRIEND', USER_PASSWORD, config()).ok).toBe(true);
  });

  it('rejects disabled users even with the right password', () => {
    createUser('gone', { passwordHash: USER_HASH, disabled: true });
    expect(verifyUserCredentials(db(), 'gone', USER_PASSWORD, config()).ok).toBe(false);
  });

  it('never returns the password hash on success', () => {
    createUser('friend', { passwordHash: USER_HASH });
    const result = verifyUserCredentials(db(), 'friend', USER_PASSWORD, config());
    expect(result.user).toMatchObject({ username: 'friend', role: 'user' });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  describe('env admin fallback', () => {
    it('accepts ADMIN_PASSWORD_HASH while user 1 has no DB hash', () => {
      expect(verifyUserCredentials(db(), 'admin', ENV_PASSWORD, config()).ok).toBe(true);
      expect(verifyUserCredentials(db(), 'admin', 'wrong', config()).ok).toBe(false);
    });

    it('accepts the dev plaintext ADMIN_PASSWORD fallback', () => {
      const devConfig = config({ passwordHash: '', password: 'dev-pass' });
      expect(verifyUserCredentials(db(), 'admin', 'dev-pass', devConfig).ok).toBe(true);
      expect(verifyUserCredentials(db(), 'admin', 'nope', devConfig).ok).toBe(false);
    });

    it('prefers the DB hash once user 1 has one', () => {
      db().prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(USER_HASH);

      expect(verifyUserCredentials(db(), 'admin', USER_PASSWORD, config()).ok).toBe(true);
      // The env password no longer works for the bootstrap row.
      expect(verifyUserCredentials(db(), 'admin', ENV_PASSWORD, config()).ok).toBe(false);
    });

    it('applies only to user 1, not to CLI-created users', () => {
      createUser('friend');
      expect(verifyUserCredentials(db(), 'friend', ENV_PASSWORD, config()).ok).toBe(false);
    });
  });

  describe('timing-stable failures', () => {
    function spyOnVerify() {
      return vi.spyOn(passwordModule, 'verifyPassword');
    }

    let verifySpy: ReturnType<typeof spyOnVerify>;

    /** Hashes the code actually compared against, in call order. */
    function verifyCalls(): string[] {
      return verifySpy.mock.calls.map(([, stored]) => String(stored));
    }

    /** True when the call targeted the lazily built dummy hash (not a user's). */
    function verifiesDummy(): boolean {
      return verifyCalls().some((stored) => stored !== USER_HASH && stored !== ENV_HASH);
    }

    beforeEach(() => {
      verifySpy = spyOnVerify();
    });

    afterEach(() => {
      verifySpy.mockRestore();
    });

    it('runs a dummy verify for unknown users', () => {
      expect(verifyUserCredentials(db(), 'ghost', USER_PASSWORD, config()).ok).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifiesDummy()).toBe(true);
    });

    it('verifies a real hash for disabled users, so they are not quicker to reject', () => {
      createUser('gone', { passwordHash: USER_HASH, disabled: true });
      expect(verifyUserCredentials(db(), 'gone', USER_PASSWORD, config()).ok).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifyCalls()).toEqual([USER_HASH]);
    });

    it('runs a dummy verify for a disabled user with no stored hash', () => {
      createUser('gone', { disabled: true });
      expect(verifyUserCredentials(db(), 'gone', USER_PASSWORD, config()).ok).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifiesDummy()).toBe(true);
    });

    it('runs a dummy verify when the bootstrap admin has no credential at all', () => {
      const noEnv = config({ passwordHash: '', password: '' });
      expect(verifyUserCredentials(db(), 'admin', USER_PASSWORD, noEnv).ok).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifiesDummy()).toBe(true);
    });

    it('still spends one scrypt on the plaintext dev fallback', () => {
      const devConfig = config({ passwordHash: '', password: 'dev-pass' });

      expect(verifyUserCredentials(db(), 'admin', 'dev-pass', devConfig).ok).toBe(true);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifiesDummy()).toBe(true);

      verifySpy.mockClear();
      expect(verifyUserCredentials(db(), 'admin', 'nope', devConfig).ok).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifiesDummy()).toBe(true);
    });

    it('verifies the env hash instead of a dummy when ADMIN_PASSWORD_HASH is set', () => {
      expect(verifyUserCredentials(db(), 'admin', ENV_PASSWORD, config()).ok).toBe(true);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifyCalls()).toEqual([ENV_HASH]);
    });
  });

  it('isAuthConfigured needs a session secret and a credential source', () => {
    expect(isAuthConfigured(db(), { admin: config().admin, sessionSecret: SECRET })).toBe(true);
    expect(isAuthConfigured(db(), { admin: config().admin, sessionSecret: '' })).toBe(false);

    const noEnv = { username: 'admin', passwordHash: '', password: '' };
    expect(isAuthConfigured(db(), { admin: noEnv, sessionSecret: SECRET })).toBe(false);
    createUser('friend', { passwordHash: USER_HASH });
    expect(isAuthConfigured(db(), { admin: noEnv, sessionSecret: SECRET })).toBe(true);
  });
});

describe('login API against the users table', () => {
  it('signs in a DB user (case-insensitive name) and embeds uid + ver in the cookie', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const res = await loginPost(loginRequest({ username: 'Friend', password: USER_PASSWORD }));

    expect(res.status).toBe(200);
    // The canonical DB spelling is returned, not the typed one.
    expect(await res.json()).toEqual({ ok: true, username: 'friend' });

    const token = res.cookies.get('shoppulse_session')!.value!;
    const user = await getCurrentUser(token, SECRET);
    expect(user).toMatchObject({ id: uid, username: 'friend' });
  });

  it('rejects a disabled DB user with the generic error', async () => {
    createUser('gone', { passwordHash: USER_HASH, disabled: true });
    const res = await loginPost(loginRequest({ username: 'gone', password: USER_PASSWORD }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
    expect(res.cookies.get('shoppulse_session')).toBeUndefined();
  });

  it('uses the env fallback for the bootstrap admin', async () => {
    const res = await loginPost(loginRequest({ username: 'admin', password: ENV_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.json()).username).toBe('admin');
  });

  it('returns the same error for unknown users and wrong passwords', async () => {
    createUser('friend', { passwordHash: USER_HASH });

    const unknown = await loginPost(loginRequest({ username: 'ghost', password: 'x' }, '10.1.0.2'));
    const wrong = await loginPost(
      loginRequest({ username: 'friend', password: 'wrong' }, '10.1.0.2'),
    );

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it('trims whitespace around the submitted username', async () => {
    createUser('friend', { passwordHash: USER_HASH });
    const res = await loginPost(loginRequest({ username: ' friend ', password: USER_PASSWORD }));
    expect(res.status).toBe(200);
  });
});

describe('session resolution against the users table', () => {
  async function tokenFor(uid: number): Promise<string> {
    const user = getUserById(db(), uid)!;
    return signSession(user.username, SECRET, sessionOptionsFor(user));
  }

  it('accepts a current session', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const user = await resolveSessionUser(db(), await tokenFor(uid), SECRET);
    expect(user).toMatchObject({ id: uid, username: 'friend' });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects legacy sessions without uid/ver', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const legacy = await signSession('friend', SECRET);
    expect(await resolveSessionUser(db(), legacy, SECRET)).toBeNull();
    expect(uid).toBeGreaterThan(1);
  });

  it('rejects a token whose uid does not exist', async () => {
    const ghost = await signSession('ghost', SECRET, { uid: 999, ver: 0 });
    expect(await resolveSessionUser(db(), ghost, SECRET)).toBeNull();
  });

  it('rejects a token whose uid and username disagree', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const mismatched = await signSession('admin', SECRET, { uid, ver: 0 });
    expect(await resolveSessionUser(db(), mismatched, SECRET)).toBeNull();
  });

  it('rejects disabled users immediately', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const token = await tokenFor(uid);

    db().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(uid);
    expect(await resolveSessionUser(db(), token, SECRET)).toBeNull();
    expect(await getCurrentUser(token, SECRET)).toBeNull();
  });

  it('session_version bump invalidates existing sessions', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const token = await tokenFor(uid);
    expect(await resolveSessionUser(db(), token, SECRET)).not.toBeNull();

    // What reset-password / disable do.
    db()
      .prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')
      .run(uid);

    expect(await resolveSessionUser(db(), token, SECRET)).toBeNull();
    // Re-login issues a token with the new version.
    const fresh = await tokenFor(uid);
    expect(await resolveSessionUser(db(), fresh, SECRET)).not.toBeNull();
  });

  it('a session from before a username change is rejected', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const token = await tokenFor(uid);
    db().prepare('UPDATE users SET username = ? WHERE id = ?').run('renamed', uid);
    expect(await resolveSessionUser(db(), token, SECRET)).toBeNull();
  });

  it('rejects invalid signatures and missing secrets', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const token = await tokenFor(uid);
    expect(await resolveSessionUser(db(), token, 'other-secret')).toBeNull();
    expect(await resolveSessionUser(db(), token, '')).toBeNull();
  });

  it('refuses legacy-format JSON even when correctly signed', async () => {
    // Simulate a pre-v2 cookie: valid signature, no uid/ver fields.
    const payload = Buffer.from(
      JSON.stringify({ sub: 'friend', iat: 1, exp: 4_000_000_000 }),
    ).toString('base64url');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const token = `${payload}.${Buffer.from(signature).toString('base64url')}`;

    createUser('friend', { passwordHash: USER_HASH });
    expect(await resolveSessionUser(db(), token, SECRET)).toBeNull();
  });
});

describe('requireAdminApi', () => {
  it('returns 401 without a valid session', async () => {
    const res = await requireAdminApi(sessionRequest('not-a-token'));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it('is enforced by admin API routes, not just middleware', async () => {
    const unauthenticated = await statsRoute(new NextRequest('http://localhost/api/admin/stats'));
    expect(unauthenticated.status).toBe(401);

    const uid = createUser('friend', { passwordHash: USER_HASH });
    const user = getUserById(db(), uid)!;
    const token = await signSession(user.username, SECRET, sessionOptionsFor(user));
    const allowed = await statsRoute(sessionRequest(token));
    expect(allowed.status).toBe(200);

    // Disabling bumps nothing here, but the DB check itself must reject.
    db().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(uid);
    const revoked = await statsRoute(sessionRequest(token));
    expect(revoked.status).toBe(401);

    const legacy = await signSession('admin', SECRET);
    expect((await statsRoute(sessionRequest(legacy))).status).toBe(401);
  });

  it('returns the active DB user', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const user = getUserById(db(), uid)!;
    const token = await signSession(user.username, SECRET, sessionOptionsFor(user));

    const result = await requireAdminApi(sessionRequest(token));
    expect(result).toMatchObject({ user: { id: uid, username: 'friend', role: 'user' } });
    expect(await getSessionUser(sessionRequest(token))).toMatchObject({ id: uid });
  });

  it('rejects a validly signed token for a disabled user', async () => {
    const uid = createUser('friend', { passwordHash: USER_HASH });
    const user = getUserById(db(), uid)!;
    const token = await signSession(user.username, SECRET, sessionOptionsFor(user));
    db().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(uid);

    const result = await requireAdminApi(sessionRequest(token));
    expect((result as Response).status).toBe(401);
  });
});
