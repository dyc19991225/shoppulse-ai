import { NextResponse, type NextRequest } from 'next/server';
import { deleteKbEntry, getKbEntry, KB_TYPES, updateKbEntry, type KbType } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import {
  asBoolean,
  asOptionalString,
  asString,
  jsonError,
  parseId,
  readJsonObject,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

export function GET(_request: NextRequest, { params }: Params): NextResponse {
  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  const entry = getKbEntry(getDb(), id);
  return entry ? NextResponse.json({ item: entry }) : jsonError(404, 'not_found');
}

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const updates: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = asString(body.title, 200);
    if (!title) return jsonError(400, 'invalid_title');
    updates.title = title;
  }
  if (body.content !== undefined) {
    const content = asString(body.content, 20000);
    if (!content) return jsonError(400, 'invalid_content');
    updates.content = content;
  }
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !KB_TYPES.includes(body.type as KbType)) {
      return jsonError(400, 'invalid_type');
    }
    updates.type = body.type;
  }
  if (body.keywords !== undefined) {
    const keywords = asOptionalString(body.keywords, 500);
    if (keywords === null) return jsonError(400, 'invalid_keywords');
    updates.keywords = keywords;
  }
  if (body.enabled !== undefined) updates.enabled = asBoolean(body.enabled, true);

  if (Object.keys(updates).length === 0) return jsonError(400, 'no_updates');

  const entry = updateKbEntry(getDb(), id, updates);
  return entry ? NextResponse.json({ item: entry }) : jsonError(404, 'not_found');
}

export function DELETE(_request: NextRequest, { params }: Params): NextResponse {
  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  return deleteKbEntry(getDb(), id)
    ? NextResponse.json({ ok: true })
    : jsonError(404, 'not_found');
}
