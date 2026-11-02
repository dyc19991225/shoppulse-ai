import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig, type AppConfig } from '../config';
import { SESSION_COOKIE, verifySession } from './session';
import { safeEqual, verifyPassword } from './password';

export * from './password';
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from './session';
export type { SessionPayload, SessionVerification } from './session';

export interface AuthResult {
  ok: boolean;
  username?: string;
}

/**
 * Checks credentials against ADMIN_PASSWORD_HASH (preferred) or, outside
 * production only, the plaintext ADMIN_PASSWORD fallback.
 * Always performs a hash comparison when a hash exists to keep timing stable.
 */
export function verifyAdminCredentials(
  username: string,
  password: string,
  config: Pick<AppConfig, 'admin'>,
): AuthResult {
  const usernameOk = safeEqual(username, config.admin.username);
  let passwordOk = false;

  if (config.admin.passwordHash) {
    passwordOk = verifyPassword(password, config.admin.passwordHash);
  } else if (config.admin.password) {
    passwordOk = safeEqual(password, config.admin.password);
  }

  return usernameOk && passwordOk ? { ok: true, username: config.admin.username } : { ok: false };
}

/** Reads and verifies the session cookie from a request. */
export async function getSessionUser(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let secret: string;
  try {
    // Session handling must work even when the LLM key is missing so the
    // admin can still sign in and inspect a misconfigured deployment.
    secret = loadConfig(undefined, { checkLlmReady: false }).sessionSecret;
  } catch {
    return null;
  }
  if (!secret) return null;
  const result = await verifySession(token, secret);
  return result.valid ? result.payload.sub : null;
}

/** Returns a 401 JSON response when the request has no valid admin session. */
export async function requireAdminApi(
  request: NextRequest,
): Promise<{ user: string } | NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { user };
}
