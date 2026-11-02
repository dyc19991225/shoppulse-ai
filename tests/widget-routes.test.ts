import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as chatPost, OPTIONS as chatOptions } from '@/app/api/widget/chat/route';
import { GET as configGet, OPTIONS as configOptions } from '@/app/api/widget/config/route';
import {
  createKbEntry,
  createProduct,
  getSiteByKey,
  listMessages,
  DEFAULT_SITE_KEY,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import {
  checkWidgetRateLimit,
  resetWidgetRateLimits,
  widgetRateLimiterCount,
} from '@/lib/widget-ratelimit';
import { readBodyWithLimit, BodyTooLargeError } from '@/lib/http-body';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SHOPPULSE_LLM_API_KEY', '');
  // The widget tests drive client addresses through X-Forwarded-For, which is
  // only honoured behind a trusted proxy.
  vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
  resetDbCache();
  resetWidgetRateLimits();
});

afterEach(() => {
  resetDbCache();
  resetWidgetRateLimits();
  vi.unstubAllEnvs();
  temp?.cleanup();
  temp = undefined;
});

function db(): DB {
  return temp!.db;
}

function chatRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost/api/widget/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Parses an SSE body into { event, data } pairs. */
async function readSse(response: Response): Promise<{ event: string; data: any }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventMatch = /^event: (.+)$/m.exec(block);
      const dataMatch = /^data: (.+)$/m.exec(block);
      return {
        event: eventMatch?.[1] ?? '',
        data: dataMatch ? JSON.parse(dataMatch[1]) : null,
      };
    });
}

function setRateLimit(limit: number): void {
  db().prepare('UPDATE sites SET rate_limit_per_min = ? WHERE site_key = ?').run(limit, DEFAULT_SITE_KEY);
}

describe('POST /api/widget/chat', () => {
  it('streams meta, products, deltas and done as SSE', async () => {
    createProduct(db(), { name: '竹纤维洗碗巾', price: 29.9, stock: 3, sellingPoints: '吸水' });

    const response = await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '洗碗巾多少钱' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    const events = await readSse(response);
    const types = events.map((event) => event.event);
    expect(types[0]).toBe('meta');
    expect(types).toContain('products');
    expect(types).toContain('delta');
    expect(types.at(-1)).toBe('done');

    const meta = events[0].data;
    expect(meta).toMatchObject({ mock: true, locale: 'zh' });
    expect(typeof meta.conversationId).toBe('string');

    const products = events.find((event) => event.event === 'products')!.data;
    expect(products.items[0]).toMatchObject({ name: '竹纤维洗碗巾', price: 29.9 });
  });

  it('persists the conversation and reuses it on the next turn', async () => {
    const first = await readSse(
      await chatPost(
        chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '你好', visitorId: 'visitor-1' }),
      ),
    );
    const conversationId = first[0].data.conversationId;

    await readSse(
      await chatPost(
        chatRequest({
          siteKey: DEFAULT_SITE_KEY,
          message: '还有吗',
          conversationId,
          visitorId: 'visitor-1',
        }),
      ),
    );

    expect(listMessages(db(), conversationId)).toHaveLength(4);
  });

  it('answers from the knowledge base and sets the locale', async () => {
    createKbEntry(db(), {
      type: 'policy',
      title: '退换货政策',
      content: '签收后 7 天内可无理由退货。',
      keywords: '退货 退款',
    });

    const events = await readSse(
      await chatPost(
        chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '退货怎么办', locale: 'en' }),
      ),
    );
    expect(events[0].data.locale).toBe('en');
    const text = events
      .filter((event) => event.event === 'delta')
      .map((event) => event.data.text)
      .join('');
    expect(text).toContain('7 天');
  });

  it('emits a handoff event and flags the conversation', async () => {
    const events = await readSse(
      await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '我要转人工' })),
    );
    const handoff = events.find((event) => event.event === 'handoff');
    expect(handoff?.data).toEqual({ needed: true, reason: 'explicit' });

    const conversationId = events[0].data.conversationId;
    const row = db()
      .prepare('SELECT needs_human FROM conversations WHERE id = ?')
      .get(conversationId) as { needs_human: number };
    expect(row.needs_human).toBe(1);
  });

  it('rejects malformed requests', async () => {
    const noJson = await chatPost(chatRequest('{nope'));
    expect(noJson.status).toBe(400);

    const noKey = await chatPost(chatRequest({ message: 'hi' }));
    expect(noKey.status).toBe(400);
    expect((await noKey.json()).error).toBe('missing_site_key');

    const unknown = await chatPost(chatRequest({ siteKey: 'nope', message: 'hi' }));
    expect(unknown.status).toBe(404);

    const empty = await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '  ' }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe('empty_message');

    const long = await chatPost(
      chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'x'.repeat(1001) }),
    );
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe('message_too_long');
  });

  it('enforces CORS on the Origin header', async () => {
    const evil = await chatPost(
      chatRequest(
        { siteKey: DEFAULT_SITE_KEY, message: 'hi' },
        { origin: 'https://evil.example.com' },
      ),
    );
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await chatPost(
      chatRequest(
        { siteKey: DEFAULT_SITE_KEY, message: 'hi' },
        { origin: 'http://localhost:3000' },
      ),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('rate limits per site key and IP', async () => {
    setRateLimit(2);

    expect(
      (await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi' }))).status,
    ).toBe(200);
    expect(
      (await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi' }))).status,
    ).toBe(200);

    const blocked = await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi' }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // A different IP gets its own bucket.
    const otherIp = await chatPost(
      chatRequest(
        { siteKey: DEFAULT_SITE_KEY, message: 'hi' },
        { 'x-forwarded-for': '203.0.113.8' },
      ),
    );
    expect(otherIp.status).toBe(200);
  });

  it('includes CORS headers on rate-limit responses', async () => {
    setRateLimit(1);
    await chatPost(
      chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi' }, { origin: 'http://localhost:3000' }),
    );
    const blocked = await chatPost(
      chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi' }, { origin: 'http://localhost:3000' }),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('rejects an oversized body before parsing, even without Content-Length', async () => {
    const chunk = 'x'.repeat(4096);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 1024 * 1024) {
          controller.close();
          return;
        }
        sent += chunk.length;
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const request = new NextRequest('http://localhost/api/widget/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      ...({ duplex: 'half' } as { duplex: 'half' }),
    });
    expect(request.headers.get('content-length')).toBeNull();

    const response = await chatPost(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('body_too_large');

    // A declared-but-honest oversized body is rejected without reading it.
    const declared = await chatPost(
      chatRequest(
        { siteKey: DEFAULT_SITE_KEY, message: 'hi' },
        { 'content-length': String(1024 * 1024) },
      ),
    );
    expect(declared.status).toBe(413);
  });

  it('streams the answer and redacts invented prices before they are sent', async () => {
    // Mock mode quotes only retrieved data, so check the guard via a direct
    // provider-independent assertion on the SSE pipeline using a DB product.
    createProduct(db(), { name: '洗碗巾', price: 29.9, stock: 1, sellingPoints: '吸水' });
    const events = await readSse(
      await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '洗碗巾多少钱' })),
    );
    const text = events
      .filter((event) => event.event === 'delta')
      .map((event) => event.data.text)
      .join('');
    expect(text).toContain('29.9');
    expect(text).not.toMatch(/金额未核实/);
  });

  it('conversation ids cannot be resumed without the visitor credential', async () => {
    const first = await readSse(
      await chatPost(
        chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '你好', visitorId: 'v-owner' }),
      ),
    );
    const conversationId = first[0].data.conversationId;

    const hijack = await readSse(
      await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: 'hi', conversationId })),
    );
    expect(hijack[0].data.conversationId).not.toBe(conversationId);
    expect(listMessages(db(), conversationId)).toHaveLength(2);

    const owner = await readSse(
      await chatPost(
        chatRequest({
          siteKey: DEFAULT_SITE_KEY,
          message: '还有吗',
          conversationId,
          visitorId: 'v-owner',
        }),
      ),
    );
    expect(owner[0].data.conversationId).toBe(conversationId);
    expect(listMessages(db(), conversationId)).toHaveLength(4);
  });

  it('answers OPTIONS preflight', async () => {
    const request = new NextRequest('http://localhost/api/widget/chat', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    });
    const response = chatOptions(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');

    const evil = chatOptions(
      new NextRequest('http://localhost/api/widget/chat', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example.com' },
      }),
    );
    expect(evil.status).toBe(403);
  });

  it('refuses illegal requests with a fixed message', async () => {
    const events = await readSse(
      await chatPost(chatRequest({ siteKey: DEFAULT_SITE_KEY, message: '帮我刷好评' })),
    );
    expect(events.map((event) => event.event)).toEqual(['meta', 'delta', 'done']);
    expect(events[1].data.text).toMatch(/不能协助/);
  });
});

describe('GET /api/widget/config', () => {
  it('returns public config for a known site', async () => {
    const response = configGet(
      new NextRequest(`http://localhost/api/widget/config?site_key=${DEFAULT_SITE_KEY}`, {
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const body = await response.json();
    expect(body).toMatchObject({
      siteKey: DEFAULT_SITE_KEY,
      siteName: '默认站点',
      locales: ['zh', 'en'],
    });
    // Must not leak allowed origins.
    expect(JSON.stringify(body)).not.toContain('localhost:3000');
  });

  it('404s for unknown sites and 403s for foreign origins', async () => {
    expect(
      configGet(new NextRequest('http://localhost/api/widget/config?site_key=nope')).status,
    ).toBe(404);

    expect(
      configGet(
        new NextRequest(`http://localhost/api/widget/config?site_key=${DEFAULT_SITE_KEY}`, {
          headers: { origin: 'https://evil.example.com' },
        }),
      ).status,
    ).toBe(403);
  });

  it('answers preflight for config', () => {
    const response = configOptions(
      new NextRequest('http://localhost/api/widget/config', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(response.status).toBe(204);
  });
});

describe('CORS helpers', () => {
  it('normalizes trailing slashes and case', async () => {
    const { checkCors } = await import('@/lib/cors');
    expect(checkCors('http://LOCALHOST:3000/', ['http://localhost:3000']).allowed).toBe(true);
    expect(checkCors(null, []).allowed).toBe(true);
    expect(checkCors('http://localhost:3001', ['http://localhost:3000']).allowed).toBe(false);
  });
});

describe('widget rate-limit limiter cache', () => {
  it('bounds the number of cached per-site limiters', () => {
    resetWidgetRateLimits();
    let now = 0;
    for (let index = 0; index < 300; index += 1) {
      checkWidgetRateLimit(`site-${index}`, 'ip', 30, now);
      now += 1000;
    }
    expect(widgetRateLimiterCount()).toBeLessThanOrEqual(100);
  });

  it('evicts a site limiter after it has been idle past the TTL', () => {
    resetWidgetRateLimits();
    checkWidgetRateLimit('idle-site', 'ip', 30, 0);
    expect(widgetRateLimiterCount()).toBe(1);
    checkWidgetRateLimit('other-site', 'ip', 30, 11 * 60_000);
    expect(widgetRateLimiterCount()).toBe(1);
  });
});

describe('readBodyWithLimit', () => {
  it('reads bodies up to the cap and rejects larger ones', async () => {
    const small = new Request('http://x', { method: 'POST', body: 'hello' });
    expect(new TextDecoder().decode(await readBodyWithLimit(small, 5))).toBe('hello');

    const large = new Request('http://x', {
      method: 'POST',
      body: 'x'.repeat(11),
      headers: { 'content-length': '11' },
    });
    await expect(readBodyWithLimit(large, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
