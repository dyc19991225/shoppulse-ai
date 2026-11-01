import { NextResponse, type NextRequest } from 'next/server';
import { getSiteByKey, listSites, type Site } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { checkCors, applyCors } from '@/lib/cors';

export const dynamic = 'force-dynamic';

export interface WidgetConfigPayload {
  siteKey: string;
  siteName: string;
  /** UI languages the widget may display. */
  locales: ['zh', 'en'];
  rateLimitPerMin: number;
}

/**
 * Public widget configuration. Never exposes allowed origins or internal ids —
 * only what the widget needs to render. CORS is still enforced so a foreign
 * site cannot enumerate site keys' configs.
 */
export function GET(request: NextRequest): NextResponse {
  const siteKey = request.nextUrl.searchParams.get('site_key')?.trim() ?? '';
  const db = getDb();
  const site: Site | null = siteKey ? getSiteByKey(db, siteKey) : null;

  if (!site) {
    return NextResponse.json({ error: 'unknown_site' }, { status: 404 });
  }

  const cors = checkCors(request.headers.get('origin'), site.allowedOrigins);
  if (!cors.allowed) {
    return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  const payload: WidgetConfigPayload = {
    siteKey: site.siteKey,
    siteName: site.name,
    locales: ['zh', 'en'],
    rateLimitPerMin: site.rateLimitPerMin,
  };

  const headers = new Headers();
  applyCors(headers, cors);
  headers.set('Cache-Control', 'public, max-age=60');
  return NextResponse.json(payload, { headers });
}

export function OPTIONS(request: NextRequest): NextResponse {
  const db = getDb();
  const siteKey = request.nextUrl.searchParams.get('site_key')?.trim() ?? '';
  const origins = siteKey
    ? (getSiteByKey(db, siteKey)?.allowedOrigins ?? [])
    : listSites(db).flatMap((site) => site.allowedOrigins);
  const cors = checkCors(request.headers.get('origin'), origins);
  const headers = new Headers();
  applyCors(headers, cors);
  return new NextResponse(null, { status: cors.allowed ? 204 : 403, headers });
}
