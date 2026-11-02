import { NextResponse, type NextRequest } from 'next/server';
import { createSite, listSites } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { asString, jsonError, readJsonObject } from '@/lib/api';
import {
  embedSnippet,
  generateSiteKey,
  isAllowedRateLimit,
  isValidSiteKey,
  MAX_SITES,
  parseOrigins,
  requestBaseUrl,
  WELCOME_MESSAGE_MAX,
} from '@/lib/sites';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Sites with their embed snippets (AC6.1). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const items = listSites(getDb(), auth.user.id);
  const base = requestBaseUrl(request);
  return NextResponse.json({
    items: items.map((site) => ({ ...site, embedSnippet: embedSnippet(site.siteKey, base) })),
    total: items.length,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const name = asString(body.name, 100);
  if (!name) return jsonError(400, 'invalid_name');

  const origins = parseOrigins(body.allowedOrigins ?? []);
  if (origins === null) return jsonError(400, 'invalid_origins');

  const rateLimit = body.rateLimitPerMin === undefined ? 30 : body.rateLimitPerMin;
  if (!isAllowedRateLimit(rateLimit)) return jsonError(400, 'invalid_rate_limit');

  const siteKey =
    body.siteKey === undefined || body.siteKey === ''
      ? generateSiteKey()
      : typeof body.siteKey === 'string'
        ? body.siteKey.trim()
        : '';
  if (!isValidSiteKey(siteKey)) return jsonError(400, 'invalid_site_key');

  if (
    body.welcomeMessage !== undefined &&
    (typeof body.welcomeMessage !== 'string' ||
      body.welcomeMessage.trim().length > WELCOME_MESSAGE_MAX)
  ) {
    return jsonError(400, 'invalid_welcome_message');
  }
  const welcomeMessage = typeof body.welcomeMessage === 'string' ? body.welcomeMessage.trim() : '';

  const db = getDb();
  if (listSites(db, auth.user.id).length >= MAX_SITES) return jsonError(409, 'too_many_sites');

  const duplicate = db
    .prepare('SELECT id FROM sites WHERE site_key = ?')
    .get(siteKey) as { id: number } | undefined;
  if (duplicate) return jsonError(409, 'duplicate_site_key');

  try {
    const site = createSite(db, auth.user.id, {
      name,
      siteKey,
      allowedOrigins: origins,
      rateLimitPerMin: rateLimit,
      welcomeMessage,
    });
    return NextResponse.json(
      { item: { ...site, embedSnippet: embedSnippet(site.siteKey, requestBaseUrl(request)) } },
      { status: 201 },
    );
  } catch {
    return jsonError(409, 'duplicate_site_key');
  }
}
