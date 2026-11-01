import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, DEFAULT_LOCALE } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/** Persists the UI language preference in a long-lived cookie. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let locale: unknown;
  try {
    const body = (await request.json()) as { locale?: unknown };
    locale = body.locale;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isLocale(locale)) {
    return NextResponse.json({ error: 'unsupported_locale' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}

export function GET(request: NextRequest): NextResponse {
  const value = request.cookies.get(LOCALE_COOKIE)?.value;
  return NextResponse.json({ locale: isLocale(value) ? value : DEFAULT_LOCALE });
}
