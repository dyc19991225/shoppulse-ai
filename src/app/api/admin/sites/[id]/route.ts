import { NextResponse, type NextRequest } from 'next/server';
import { deleteSite, getSiteById, updateSite, type SiteInput } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { asString, jsonError, parseId, readJsonObject } from '@/lib/api';
import { forgetWidgetRateLimit } from '@/lib/widget-ratelimit';
import {
  embedSnippet,
  isAllowedRateLimit,
  isValidSiteKey,
  parseOrigins,
  requestBaseUrl,
  WELCOME_MESSAGE_MAX,
} from '@/lib/sites';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  const site = getSiteById(getDb(), auth.user.id, id);
  if (!site) return jsonError(404, 'not_found');
  return NextResponse.json({ item: { ...site, embedSnippet: embedSnippet(site.siteKey, requestBaseUrl(request)) } });
}

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const updates: Partial<SiteInput> = {};

  if (body.name !== undefined) {
    const name = asString(body.name, 100);
    if (!name) return jsonError(400, 'invalid_name');
    updates.name = name;
  }

  if (body.siteKey !== undefined) {
    const siteKey = asString(body.siteKey, 64);
    if (!siteKey || !isValidSiteKey(siteKey)) return jsonError(400, 'invalid_site_key');
    const duplicate = getDb()
      .prepare('SELECT id FROM sites WHERE site_key = ? AND id != ?')
      .get(siteKey, id) as { id: number } | undefined;
    if (duplicate) return jsonError(409, 'duplicate_site_key');
    updates.siteKey = siteKey;
  }

  if (body.allowedOrigins !== undefined) {
    const origins = parseOrigins(body.allowedOrigins);
    if (origins === null) return jsonError(400, 'invalid_origins');
    updates.allowedOrigins = origins;
  }

  if (body.rateLimitPerMin !== undefined) {
    if (!isAllowedRateLimit(body.rateLimitPerMin)) return jsonError(400, 'invalid_rate_limit');
    updates.rateLimitPerMin = body.rateLimitPerMin;
  }

  if (body.welcomeMessage !== undefined) {
    if (typeof body.welcomeMessage !== 'string') {
      return jsonError(400, 'invalid_welcome_message');
    }
    const welcomeMessage = body.welcomeMessage.trim();
    if (welcomeMessage.length > WELCOME_MESSAGE_MAX) {
      return jsonError(400, 'invalid_welcome_message');
    }
    updates.welcomeMessage = welcomeMessage;
  }

  if (Object.keys(updates).length === 0) return jsonError(400, 'no_updates');

  const site = updateSite(getDb(), auth.user.id, id, updates);
  if (!site) return jsonError(404, 'not_found');
  return NextResponse.json({ item: { ...site, embedSnippet: embedSnippet(site.siteKey, requestBaseUrl(request)) } });
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  const db = getDb();
  const site = getSiteById(db, auth.user.id, id);
  if (!site) return jsonError(404, 'not_found');
  try {
    if (!deleteSite(db, auth.user.id, id)) return jsonError(404, 'not_found');
    forgetWidgetRateLimit(site.siteKey);
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(409, 'site_has_conversations');
  }
}
