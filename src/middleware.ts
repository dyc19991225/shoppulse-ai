import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { clientIp, RateLimiter } from '@/lib/ratelimit';

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};

/**
 * Edge session guard:
 * - Page requests without a session redirect to /login?next=<path>.
 * - API requests without a session return 401 JSON.
 * Uses only Web Crypto (see lib/auth/session.ts) so it runs in the Edge runtime.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // Cheap IP-level guard against brute-forcing protected endpoints.
  const guard = edgeGuard.check(`edge:${clientIp(request)}`);
  if (!guard.allowed) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    return new NextResponse('Too many requests', { status: 429 });
  }

  const secret = process.env.SESSION_SECRET ?? '';
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const verification = secret ? await verifySession(token, secret) : { valid: false as const, reason: 'malformed' as const };

  if (verification.valid) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  const response = NextResponse.redirect(loginUrl);
  if (token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

/** Separate bucket from the login limiter; generous for normal admin usage. */
const edgeGuard = new RateLimiter({ limit: 600, windowMs: 60_000 });
