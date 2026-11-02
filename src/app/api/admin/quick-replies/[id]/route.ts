import { NextResponse, type NextRequest } from 'next/server';
import {
  deleteQuickReply,
  getQuickReply,
  QUICK_REPLY_CONTENT_MAX,
  QUICK_REPLY_TITLE_MAX,
  updateQuickReply,
  type QuickReplyInput,
} from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { asString, jsonError, parseId, readJsonObject } from '@/lib/api';
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
  const item = getQuickReply(getDb(), auth.user.id, id);
  return item ? NextResponse.json({ item }) : jsonError(404, 'not_found');
}

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const updates: Partial<QuickReplyInput> = {};
  if (body.title !== undefined) {
    const title = asString(body.title, QUICK_REPLY_TITLE_MAX);
    if (!title) return jsonError(400, 'invalid_title');
    updates.title = title;
  }
  if (body.content !== undefined) {
    const content = asString(body.content, QUICK_REPLY_CONTENT_MAX);
    if (!content) return jsonError(400, 'invalid_content');
    updates.content = content;
  }
  if (Object.keys(updates).length === 0) return jsonError(400, 'no_updates');

  const item = updateQuickReply(getDb(), auth.user.id, id, updates);
  return item ? NextResponse.json({ item }) : jsonError(404, 'not_found');
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  return deleteQuickReply(getDb(), auth.user.id, id)
    ? NextResponse.json({ ok: true })
    : jsonError(404, 'not_found');
}
