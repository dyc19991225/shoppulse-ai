import { NextResponse, type NextRequest } from 'next/server';
import { getSiteByKey, listAgentMessagesForVisitor, listAllAllowedOrigins } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { applyCors, checkCors } from '@/lib/cors';
import { clientIp } from '@/lib/ratelimit';
import { checkWidgetRateLimit } from '@/lib/widget-ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Values longer than this cannot be a real id / timestamp we issued. */
const MAX_PARAM_LENGTH = 200;

function corsJson(
  status: number,
  code: string,
  cors: { headers: Record<string, string> },
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: code },
    { status, headers: { ...cors.headers, ...extraHeaders } },
  );
}

/**
 * F3 widget polling. Authorization mirrors chat: a known site key, an allowed
 * origin and the visitor id the conversation was created with. The visitor id
 * is the credential, so every mismatch answers the same 404 `not_found`.
 * Only `agent` messages are exposed, optionally those created strictly after
 * `after` (ISO timestamp). Rate-limited like chat.
 */
export function GET(request: NextRequest): NextResponse {
  const params = request.nextUrl.searchParams;
  const siteKey = params.get('site_key')?.trim() ?? '';
  if (!siteKey) return NextResponse.json({ error: 'missing_site_key' }, { status: 400 });

  const conversationId = params.get('conversation_id')?.trim() ?? '';
  const visitorId = params.get('visitor_id')?.trim() ?? '';
  if (!conversationId || !visitorId) {
    return NextResponse.json({ error: 'missing_conversation' }, { status: 400 });
  }

  const after = params.get('after')?.trim() ?? '';
  if (after) {
    const date = new Date(after);
    if (
      after.length > MAX_PARAM_LENGTH ||
      Number.isNaN(date.getTime())
    ) {
      return NextResponse.json({ error: 'invalid_after' }, { status: 400 });
    }
  }

  const db = getDb();
  const site = getSiteByKey(db, siteKey);
  if (!site) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const cors = checkCors(request.headers.get('origin'), site.allowedOrigins);
  if (!cors.allowed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const limit = checkWidgetRateLimit(site.siteKey, clientIp(request), site.rateLimitPerMin);
  if (!limit.allowed) {
    return corsJson(429, 'rate_limited', cors, {
      'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
    });
  }

  const items = listAgentMessagesForVisitor(
    db,
    site.id,
    conversationId,
    visitorId,
    after || undefined,
  );
  if (items === null) return corsJson(404, 'not_found', cors);

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  applyCors(headers, cors);
  return NextResponse.json({ items }, { headers });
}

export function OPTIONS(request: NextRequest): Response {
  const db = getDb();
  const siteKey = request.nextUrl.searchParams.get('site_key')?.trim() ?? '';
  const origins = siteKey
    ? (getSiteByKey(db, siteKey)?.allowedOrigins ?? [])
    : listAllAllowedOrigins(db);
  const cors = checkCors(request.headers.get('origin'), origins);
  const headers = new Headers();
  applyCors(headers, cors);
  return new Response(null, { status: cors.allowed ? 204 : 403, headers });
}
