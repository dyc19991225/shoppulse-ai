import { NextResponse, type NextRequest } from 'next/server';
import { ConfigError, loadConfig } from '@/lib/config';
import { sessionCookieOptions, signSession, verifyAdminCredentials, SESSION_COOKIE } from '@/lib/auth';
import { clientIp, getLoginLimiter } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const limiter = getLoginLimiter();
  const limit = limiter.check(`login:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return NextResponse.json({ error: 'missing_credentials' }, { status: 400 });
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: 'not_configured' }, { status: 500 });
    }
    throw error;
  }

  if (!config.admin.passwordHash && !config.admin.password) {
    return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  }
  if (!config.sessionSecret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  }

  const result = verifyAdminCredentials(username, password, config);
  if (!result.ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // A successful sign-in clears this IP's failure budget.
  limiter.reset(`login:${ip}`);

  const token = await signSession(result.username!, config.sessionSecret);
  const response = NextResponse.json({ ok: true, username: result.username });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(config.isProduction));
  return response;
}
