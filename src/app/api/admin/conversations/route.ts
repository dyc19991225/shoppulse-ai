import { NextResponse, type NextRequest } from 'next/server';
import { listConversations, type ConversationListOptions } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { jsonError, parseId } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';
import { normalizeTag } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

/** Conversation list with filters (AC7.1). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const options: ConversationListOptions = {};

  const siteParam = params.get('siteId');
  if (siteParam) {
    const siteId = parseId(siteParam);
    if (!siteId) return jsonError(400, 'invalid_site_id');
    options.siteId = siteId;
  }

  const tagParam = params.get('tag');
  if (tagParam !== null) {
    const tag = normalizeTag(tagParam);
    if (tag === null) return jsonError(400, 'invalid_tag');
    options.tag = tag;
  }

  for (const key of ['needsHuman', 'handled'] as const) {
    const value = params.get(key);
    if (value === null) continue;
    if (value !== 'true' && value !== 'false') {
      return jsonError(400, `invalid_${key === 'needsHuman' ? 'needs_human' : 'handled'}`);
    }
    options[key] = value === 'true';
  }

  const limitParam = params.get('limit');
  if (limitParam !== null) {
    const limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return jsonError(400, 'invalid_limit');
    options.limit = limit;
  }

  const offsetParam = params.get('offset');
  if (offsetParam !== null) {
    const offset = Number(offsetParam);
    if (!Number.isInteger(offset) || offset < 0) return jsonError(400, 'invalid_offset');
    options.offset = offset;
  }

  return NextResponse.json(listConversations(getDb(), auth.user.id, options));
}
