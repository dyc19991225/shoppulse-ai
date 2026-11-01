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
import { resetWidgetRateLimits } from '@/lib/widget-ratelimit';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SHOPPULSE_LLM_API_KEY', '');
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
