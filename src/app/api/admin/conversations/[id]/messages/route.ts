import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import { jsonError, readJsonObject } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';
import { validateAgentMessageContent } from '@/lib/inbox';
import { addAgentReply } from '@/lib/inbox-server';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

/**
 * F3 agent reply. The message is stored with role `agent`, which the widget
 * polls for and the next LLM turn sees as an assistant message. `markHandled`
 * optionally marks the conversation handled in the same action.
 */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const content = validateAgentMessageContent(body.content);
  if (content === null) return jsonError(400, 'invalid_content');

  if (body.markHandled !== undefined && typeof body.markHandled !== 'boolean') {
    return jsonError(400, 'invalid_mark_handled');
  }

  const db = getDb();
  const message = addAgentReply(db, auth.user.id, {
    id: randomUUID(),
    conversationId: params.id,
    content,
    markHandled: body.markHandled,
  });
  if (!message) return jsonError(404, 'not_found');

  return NextResponse.json({ ok: true, item: message }, { status: 201 });
}
