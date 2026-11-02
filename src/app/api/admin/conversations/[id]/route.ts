import { NextResponse, type NextRequest } from 'next/server';
import {
  countMessages,
  getConversation,
  listMessages,
  setConversationHandled,
  updateConversation,
  type ConversationSummary,
  type ConversationUpdate,
} from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { jsonError, readJsonObject } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';
import { isValidNote, normalizeTags } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Conversation detail: metadata plus the full transcript. */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const db = getDb();
  const conversation = getConversation(db, auth.user.id, params.id);
  if (!conversation) return jsonError(404, 'not_found');

  const siteRow = db
    .prepare('SELECT name FROM sites WHERE id = ? AND owner_id = ?')
    .get(conversation.siteId, auth.user.id) as { name: string } | undefined;
  const summary: ConversationSummary = {
    ...conversation,
    siteName: siteRow?.name ?? '',
    messageCount: countMessages(db, auth.user.id, conversation.id),
  };

  return NextResponse.json({
    item: summary,
    messages: listMessages(db, auth.user.id, conversation.id),
  });
}

interface UpdateBody {
  handled?: unknown;
}

/** Marks a conversation handled (or unhandled). */
export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  if (!body || typeof body !== 'object' || typeof body.handled !== 'boolean') {
    return jsonError(400, 'invalid_handled');
  }

  const db = getDb();
  if (!getConversation(db, auth.user.id, params.id)) return jsonError(404, 'not_found');

  setConversationHandled(db, auth.user.id, params.id, body.handled);
  return NextResponse.json({ ok: true, handled: body.handled });
}

/**
 * F3: tags, internal note and handled flag. Every field is optional, but at
 * least one must be present. Tag lists are trimmed, de-duplicated and bounded
 * (≤10, each 1–20 chars); the note is ≤2000 characters.
 */
export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const updates: ConversationUpdate = {};

  if (body.tags !== undefined) {
    const tags = normalizeTags(body.tags);
    if (tags === null) return jsonError(400, 'invalid_tags');
    updates.tags = tags;
  }
  if (body.note !== undefined) {
    if (!isValidNote(body.note)) return jsonError(400, 'invalid_note');
    updates.note = body.note;
  }
  if (body.handled !== undefined) {
    if (typeof body.handled !== 'boolean') return jsonError(400, 'invalid_handled');
    updates.handled = body.handled;
  }

  if (Object.keys(updates).length === 0) return jsonError(400, 'no_updates');

  const conversation = updateConversation(getDb(), auth.user.id, params.id, updates);
  if (!conversation) return jsonError(404, 'not_found');
  return NextResponse.json({ ok: true, item: conversation });
}
