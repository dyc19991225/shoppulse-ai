import { NextResponse, type NextRequest } from 'next/server';
import { createQuickReply, listQuickReplies, QUICK_REPLY_CONTENT_MAX, QUICK_REPLY_TITLE_MAX } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { asString, jsonError, readJsonObject } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Quick-reply library (F2). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const items = listQuickReplies(getDb(), auth.user.id);
  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const title = asString(body.title, QUICK_REPLY_TITLE_MAX);
  const content = asString(body.content, QUICK_REPLY_CONTENT_MAX);
  if (!title || !content) {
    return jsonError(400, 'invalid_input', { fields: { title: !title, content: !content } });
  }

  const item = createQuickReply(getDb(), auth.user.id, { title, content });
  return NextResponse.json({ item }, { status: 201 });
}
