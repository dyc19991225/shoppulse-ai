import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig, type AppConfig } from '../config';
import { getUserById, getUserByUsername, type DB, type User } from '../db';
import { getDb } from '../db-runtime';
import { SESSION_COOKIE, signSession, verifySession } from './session';
import { hashPasswordSync, safeEqual, verifyPassword } from './password';

export * from './password';
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from './session';
export type { SessionPayload, SessionVerification } from './session';

/**
 * Built once, lazily: the unknown-user path spends the same scrypt time as a
 * real verification, so usernames cannot be enumerated by response timing.
 */
let dummyHash: string | null = null;
function getDummyHash(): string {
  if (!dummyHash) dummyHash = hashPasswordSync('timing-stable-dummy-password');
  return dummyHash;
}

export interface AuthResult {
  ok: boolean;
  user?: User;
}

/** Verifies the env admin hash (or the dev-only plaintext password). */
function verifyEnvPassword(password: string, config: Pick<AppConfig, 'admin'>): boolean {
  if (config.admin.passwordHash) return verifyPassword(password, config.admin.passwordHash);
  if (config.admin.password) return safeEqual(password, config.admin.password);
  return false;
}

/**
 * Authenticates a login attempt against the users table.
 *
 * - Unknown users, disabled users, malformed/absent stored hashes and a
 *   bootstrap admin without credentials all run one scrypt verify, so
 *   response timing does not reveal which usernames exist or their state.
 * - Disabled users and wrong passwords return the same generic failure.
 * - The bootstrap admin row falls back to the env hash/password while its own
 *   password_hash is empty (so rotating ADMIN_PASSWORD_HASH keeps working).
 */
export function verifyUserCredentials(
  db: DB,
  username: string,
  password: string,
  config: Pick<AppConfig, 'admin'>,
): AuthResult {
  const user = getUserByUsername(db, username);
  const storedHash = user?.passwordHash ?? '';

  // Exactly one scrypt verification on every path: stored hash when present,
  // env fallback for user 1, and a dummy verify whenever no real hash was
  // checked. The dev-only plaintext ADMIN_PASSWORD still pays the dummy cost
  // so it cannot be told apart by response timing either.
  let passwordOk = false;
  if (storedHash) {
    passwordOk = verifyPassword(password, storedHash);
  } else if (user?.id === 1 && (config.admin.passwordHash || config.admin.password)) {
    passwordOk = verifyEnvPassword(password, config);
    if (!config.admin.passwordHash) verifyPassword(password, getDummyHash());
  } else {
    verifyPassword(password, getDummyHash());
  }

  if (!user || user.disabled || !passwordOk) return { ok: false };
  const { passwordHash: _hash, ...safeUser } = user;
  return { ok: true, user: safeUser };
}

/** Whether login can run at all: a session secret plus some credential source. */
export function isAuthConfigured(
  db: DB,
  config: Pick<AppConfig, 'admin' | 'sessionSecret'>,
): boolean {
  if (!config.sessionSecret) return false;
  if (config.admin.passwordHash || config.admin.password) return true;
  const row = db.prepare("SELECT 1 FROM users WHERE password_hash != '' LIMIT 1").get();
  return row !== undefined;
}

/** Token payload options for a freshly authenticated user. */
export function sessionOptionsFor(
  user: Pick<User, 'id' | 'sessionVersion'>,
): { uid: number; ver: number } {
  return { uid: user.id, ver: user.sessionVersion };
}

/**
 * Resolves a session token to the *current* database user. Rejects legacy
 * tokens without uid/ver, disabled users, renamed users and sessions issued
 * before a disable/reset bumped session_version. Node-only (the Edge
 * middleware just verifies the signature).
 */
export async function resolveSessionUser(
  db: DB,
  token: string | undefined,
  secret: string,
): Promise<User | null> {
  if (!secret) return null;
  const result = await verifySession(token, secret);
  if (!result.valid) return null;

  const { uid, ver, sub } = result.payload;
  if (!Number.isInteger(uid) || uid <= 0) return null;
  if (!Number.isInteger(ver) || ver < 0) return null;

  const user = getUserById(db, uid);
  if (!user || user.disabled) return null;
  if (user.username !== sub || user.sessionVersion !== ver) return null;

  const { passwordHash: _hash, ...safeUser } = user;
  return safeUser;
}

/** Reads the config secret without the LLM readiness check (login must work while misconfigured). */
export function loadSessionSecret(): string {
  try {
    return loadConfig(undefined, { checkLlmReady: false }).sessionSecret;
  } catch {
    return '';
  }
}

/**
 * Resolves a raw session cookie value to an active DB user (or null).
 * A missing cookie/secret returns before the database is opened.
 */
export async function getCurrentUser(
  token: string | undefined,
  secret = loadSessionSecret(),
): Promise<User | null> {
  if (!secret || !token) return null;
  return resolveSessionUser(getDb(), token, secret);
}

/** Resolves the request cookie to an active DB user (or null). */
export function getSessionUser(request: NextRequest): Promise<User | null> {
  return getCurrentUser(request.cookies.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 JSON response when the request has no valid, current session. */
export async function requireAdminApi(
  request: NextRequest,
): Promise<{ user: User } | NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { user };
}
