import { NextResponse, type NextRequest } from 'next/server';
import {
  createKbEntry,
  KB_TYPES,
  listKbEntries,
  type KbInput,
  type KbType,
} from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { asBoolean, asOptionalString, asString, jsonError, readJsonObject } from '@/lib/api';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const db = getDb();
  const search = request.nextUrl.searchParams.get('search')?.trim() || undefined;
  const entries = listKbEntries(db, { search });
  return NextResponse.json({ items: entries, total: entries.length });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const title = asString(body.title, 200);
  const content = asString(body.content, 20000);
  if (!title || !content) {
    return jsonError(400, 'invalid_input', { fields: { title: !title, content: !content } });
  }

  const type = (body.type === undefined ? 'faq' : body.type) as unknown;
  if (typeof type !== 'string' || !KB_TYPES.includes(type as KbType)) {
    return jsonError(400, 'invalid_type');
  }

  const keywords = asOptionalString(body.keywords, 500);
  if (keywords === null) return jsonError(400, 'invalid_keywords');

  const input: KbInput = {
    type: type as KbType,
    title,
    content,
    keywords: keywords ?? '',
    enabled: asBoolean(body.enabled, true),
  };

  const entry = createKbEntry(getDb(), input);
  return NextResponse.json({ item: entry }, { status: 201 });
}
