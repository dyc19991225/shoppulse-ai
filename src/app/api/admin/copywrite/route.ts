import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import {
  COPY_PLATFORMS,
  COPY_TONES,
  CopywriteError,
  generateCopywriting,
  isCopyPlatform,
  isCopyTone,
  type CopyPlatform,
  type CopywriteInput,
} from '@/lib/copywriting';
import { listCopyHistory } from '@/lib/db';
import { createProvider, LlmError } from '@/lib/llm';
import { loadConfig } from '@/lib/config';
import { asString, jsonError, parseId, readJsonObject } from '@/lib/api';
import { isLocale, type Locale } from '@/lib/i18n';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_AUDIENCE = 300;
const MAX_SELLING_POINTS = 10;
const MAX_SELLING_POINT_LENGTH = 200;

/** Recent generation history for the copy studio sidebar. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 20;
  const items = listCopyHistory(getDb(), auth.user.id, { limit });
  return NextResponse.json({ items, total: items.length });
}

function parseSellingPoints(value: unknown): string[] | null {
  let parts: string[];
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    parts = value.split(/\n+/);
  } else if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== 'string')) return null;
    parts = value as string[];
  } else {
    return null;
  }
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (cleaned.length > MAX_SELLING_POINTS) return null;
  if (cleaned.some((part) => part.length > MAX_SELLING_POINT_LENGTH)) return null;
  return cleaned;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const productId = parseId(String(body.productId ?? ''));
  if (!productId) return jsonError(400, 'invalid_product');

  const audience = body.audience === undefined ? '' : asString(body.audience, MAX_AUDIENCE);
  if (audience === null) return jsonError(400, 'invalid_audience');

  const sellingPoints = parseSellingPoints(body.sellingPoints);
  if (sellingPoints === null) return jsonError(400, 'invalid_selling_points');

  const tone = body.tone === undefined ? 'lively' : body.tone;
  if (!isCopyTone(tone)) return jsonError(400, 'invalid_tone');

  let platforms: CopyPlatform[];
  if (body.platforms === undefined) {
    platforms = [...COPY_PLATFORMS];
  } else if (
    Array.isArray(body.platforms) &&
    body.platforms.length > 0 &&
    body.platforms.every(isCopyPlatform)
  ) {
    platforms = [...new Set(body.platforms as CopyPlatform[])];
  } else {
    return jsonError(400, 'invalid_platforms');
  }

  const lang: Locale = isLocale(body.lang) ? body.lang : 'zh';

  let provider;
  try {
    provider = createProvider(loadConfig());
  } catch {
    return jsonError(503, 'llm_misconfigured');
  }

  const input: CopywriteInput = {
    productId,
    audience: audience ?? '',
    sellingPoints,
    tone,
    platforms,
    lang,
  };

  try {
    const result = await generateCopywriting(getDb(), auth.user.id, provider, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CopywriteError) {
      if (error.code === 'product_not_found') return jsonError(404, 'product_not_found');
      if (error.code === 'content_blocked') {
        return jsonError(422, 'content_blocked', { refusal: error.refusal });
      }
      return jsonError(502, 'generation_failed');
    }
    if (error instanceof LlmError) return jsonError(502, 'generation_failed');
    throw error;
  }
}
