import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getSiteByKey, listAllAllowedOrigins } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { createProvider, LlmError } from '@/lib/llm';
import {
  ChatInputError,
  MAX_CHAT_BODY_BYTES,
  runChat,
  validateMessage,
  type ChatEvent,
} from '@/lib/chat';
import { BodyTooLargeError, readJsonObjectWithLimit } from '@/lib/http-body';
import { applyCors, checkCors } from '@/lib/cors';
import { clientIp } from '@/lib/ratelimit';
import { checkWidgetRateLimit } from '@/lib/widget-ratelimit';
import { isLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ChatBody {
  siteKey?: unknown;
  message?: unknown;
  conversationId?: unknown;
  visitorId?: unknown;
  locale?: unknown;
}

function formatSse(event: ChatEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** JSON error that still carries CORS headers so the widget can read it. */
function corsJson(
  status: number,
  code: string,
  cors: { headers: Record<string, string> },
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: code },
    { status, headers: { ...cors.headers, ...extraHeaders } },
  );
}

/**
 * Public chat endpoint (AC5.1–AC5.6, AC6.2–AC6.3).
 *
 * Order of checks: body size/parse → site key → CORS → rate limit → validation
 * → SSE. The body is capped before parsing so public requests cannot buffer
 * unbounded JSON. The response is a hand-rolled ReadableStream so we control
 * flushing and can abort the provider when the client disconnects.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: ChatBody;
  try {
    const parsed = await readJsonObjectWithLimit(request, MAX_CHAT_BODY_BYTES);
    if (!parsed) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    body = parsed as ChatBody;
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
    }
    throw error;
  }

  const siteKey = typeof body.siteKey === 'string' ? body.siteKey.trim() : '';
  if (!siteKey) return NextResponse.json({ error: 'missing_site_key' }, { status: 400 });

  const db = getDb();
  const site = getSiteByKey(db, siteKey);
  if (!site) return NextResponse.json({ error: 'unknown_site' }, { status: 404 });

  const cors = checkCors(request.headers.get('origin'), site.allowedOrigins);
  if (!cors.allowed) {
    return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  const limit = checkWidgetRateLimit(site.siteKey, clientIp(request), site.rateLimitPerMin);
  if (!limit.allowed) {
    return corsJson(429, 'rate_limited', cors, {
      'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
    });
  }

  let message: string;
  try {
    message = validateMessage(body.message);
  } catch (error) {
    if (error instanceof ChatInputError) {
      return corsJson(400, error.code, cors);
    }
    throw error;
  }

  const locale: Locale = isLocale(body.locale) ? body.locale : 'zh';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId.slice(0, 100) : null;

  let provider;
  try {
    provider = createProvider(loadConfig());
  } catch {
    return corsJson(503, 'llm_misconfigured', cors);
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSse(event)));
        } catch {
          closed = true;
        }
      };
      try {
        for await (const event of runChat({
          db,
          provider,
          site,
          message,
          conversationId,
          visitorId,
          locale,
          signal: abort.signal,
        })) {
          send(event);
        }
      } catch (error) {
        // Never leak provider/gateway details to the browser. The fixed code
        // is enough for the widget to show its generic error message; stack
        // details stay on the server (without message contents or keys).
        console.warn('[widget] chat stream failed', {
          name: error instanceof Error ? error.name : 'unknown',
          llm: error instanceof LlmError,
          status: error instanceof LlmError ? error.status : undefined,
        });
        send({
          event: 'error',
          data: { message: error instanceof LlmError ? 'llm_unavailable' : 'chat_failed' },
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by cancellation.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  applyCors(headers, cors);

  return new Response(stream, { status: 200, headers });
}

/**
 * Preflight. Browsers cannot send a JSON body here, so when no `site_key`
 * query param is present we accept the origin if any site allows it. The POST
 * itself re-checks against the concrete site.
 */
export function OPTIONS(request: NextRequest): Response {
  const db = getDb();
  const siteKey = request.nextUrl.searchParams.get('site_key')?.trim() ?? '';
  const origins = siteKey
    ? (getSiteByKey(db, siteKey)?.allowedOrigins ?? [])
    : listAllAllowedOrigins(db);
  const cors = checkCors(request.headers.get('origin'), origins);
  const headers = new Headers();
  applyCors(headers, cors);
  return new Response(null, { status: cors.allowed ? 204 : 403, headers });
}
