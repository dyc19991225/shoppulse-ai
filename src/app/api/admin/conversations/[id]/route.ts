import { NextResponse, type NextRequest } from 'next/server';
import {
  getConversation,
  listMessages,
  setConversationHandled,
  type ConversationSummary,
} from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/** Conversation detail: metadata plus the full transcript. */
export function GET(_request: NextRequest, { params }: Params): NextResponse {
  const db = getDb();
  const conversation = getConversation(db, params.id);
  if (!conversation) return jsonError(404, 'not_found');

  const siteRow = db
    .prepare('SELECT name FROM sites WHERE id = ?')
    .get(conversation.siteId) as { name: string } | undefined;
  const messageCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
      .get(conversation.id) as { count: number }
  ).count;

  const summary: ConversationSummary = {
    ...conversation,
    siteName: siteRow?.name ?? '',
    messageCount,
  };

  return NextResponse.json({ item: summary, messages: listMessages(db, conversation.id) });
}

interface UpdateBody {
  handled?: unknown;
}

/** Marks a conversation handled (or unhandled). */
export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
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
  if (!getConversation(db, params.id)) return jsonError(404, 'not_found');

  setConversationHandled(db, params.id, body.handled);
  return NextResponse.json({ ok: true, handled: body.handled });
}
