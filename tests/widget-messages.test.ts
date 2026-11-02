import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as messagesGet, OPTIONS as messagesOptions } from '@/app/api/widget/messages/route';
import { GET as configGet } from '@/app/api/widget/config/route';
import { GET as listRoute } from '@/app/api/admin/conversations/route';
import { POST as replyRoute } from '@/app/api/admin/conversations/[id]/messages/route';
import {
  addMessage,
  createConversation,
  createSite,
  updateSite,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { resetWidgetRateLimits } from '@/lib/widget-ratelimit';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

/**
 * F3 public polling endpoint. The visitor id is the credential: wrong site,
 * origin, visitor or owner must all fail closed, and only `agent` messages
 * newer than `after` may ever be returned.
 */

const OWNER_A = 1;
const OWNER_B = 2;

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('SHOPPULSE_TRUST_PROXY', '1');
  resetDbCache();
  resetWidgetRateLimits();

  temp.db
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
       VALUES (?, 'beta', '', 'user', 0, 0, ?)`,
    )
    .run(OWNER_B, new Date().toISOString());
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

/** A site for owner A plus a conversation belonging to visitor-a. */
function seedConversation() {
  const site = createSite(db(), OWNER_A, {
    name: 'A widget site',
    siteKey: 'a-widget-key',
    allowedOrigins: ['https://a.example.com'],
    rateLimitPerMin: 30,
  });
  createConversation(db(), OWNER_A, {
    id: 'conv-a',
    siteId: site.id,
    visitorId: 'visitor-a',
  });
  addMessage(db(), OWNER_A, {
    id: 'user-1',
    conversationId: 'conv-a',
    role: 'user',
    content: '在吗？',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
  addMessage(db(), OWNER_A, {
    id: 'ai-1',
    conversationId: 'conv-a',
    role: 'assistant',
    content: '在的。',
    createdAt: '2024-01-01T00:00:01.000Z',
  });
  addMessage(db(), OWNER_A, {
    id: 'agent-1',
    conversationId: 'conv-a',
    role: 'agent',
    content: '人工客服已上线。',
    createdAt: '2024-01-01T00:00:02.000Z',
  });
  addMessage(db(), OWNER_A, {
    id: 'agent-2',
    conversationId: 'conv-a',
    role: 'agent',
    content: '已为您备注。',
    createdAt: '2024-01-01T00:00:03.000Z',
  });
  return site;
}

function request(
  query: Record<string, string>,
  headers: Record<string, string> = {},
): NextRequest {
  const params = new URLSearchParams(query);
  return new NextRequest(`http://localhost/api/widget/messages?${params.toString()}`, {
    headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
  });
}

const QUERY = {
  site_key: 'a-widget-key',
  conversation_id: 'conv-a',
  visitor_id: 'visitor-a',
};

describe('GET /api/widget/messages', () => {
  it('returns only agent messages of the matching conversation', async () => {
    const site = seedConversation();
    const response = messagesGet(request(QUERY, { origin: 'https://a.example.com' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://a.example.com');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['agent-1', 'agent-2']);
    expect(body.items[0]).toMatchObject({
      conversationId: 'conv-a',
      role: 'agent',
      content: '人工客服已上线。',
    });
    // No internal site data leaks.
    expect(JSON.stringify(body)).not.toContain(site.siteKey);
  });

  it('returns only agent messages created strictly after `after`', async () => {
    seedConversation();
    const body = await (
      await messagesGet(
        request({ ...QUERY, after: '2024-01-01T00:00:02.000Z' }, { origin: 'https://a.example.com' }),
      )
    ).json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['agent-2']);

    const none = await (
      await messagesGet(
        request({ ...QUERY, after: '2024-01-01T00:00:03.000Z' }, { origin: 'https://a.example.com' }),
      )
    ).json();
    expect(none.items).toEqual([]);
  });

  it('rejects a wrong visitor, conversation or site with the same 404', async () => {
    seedConversation();
    const cases: Record<string, string>[] = [
      { ...QUERY, visitor_id: 'visitor-other' },
      { ...QUERY, conversation_id: 'missing' },
    ];
    for (const query of cases) {
      const response = messagesGet(request(query, { origin: 'https://a.example.com' }));
      expect(response.status, JSON.stringify(query)).toBe(404);
      expect((await response.json()).error).toBe('not_found');
    }

    // An unknown site key is rejected like the config endpoint does.
    const unknown = messagesGet(request({ ...QUERY, site_key: 'unknown' }));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe('unknown_site');
  });

  it("never reveals another owner's conversation, even to the right site key shape", async () => {
    seedConversation();
    const siteB = createSite(db(), OWNER_B, {
      name: 'B widget site',
      siteKey: 'b-widget-key',
      allowedOrigins: ['https://b.example.com'],
      rateLimitPerMin: 30,
    });
    createConversation(db(), OWNER_B, {
      id: 'conv-b',
      siteId: siteB.id,
      visitorId: 'visitor-b',
    });
    addMessage(db(), OWNER_B, {
      id: 'b-agent',
      conversationId: 'conv-b',
      role: 'agent',
      content: 'B 的人工回复',
      createdAt: '2024-01-01T00:00:02.000Z',
    });

    // A's site key cannot read B's conversation...
    const viaSiteA = messagesGet(
      request(
        { site_key: 'a-widget-key', conversation_id: 'conv-b', visitor_id: 'visitor-b' },
        { origin: 'https://a.example.com' },
      ),
    );
    expect(viaSiteA.status).toBe(404);

    // ...and B's own site key cannot be used from A's origin.
    const viaSiteB = messagesGet(
      request(
        { site_key: 'b-widget-key', conversation_id: 'conv-b', visitor_id: 'visitor-b' },
        { origin: 'https://a.example.com' },
      ),
    );
    expect(viaSiteB.status).toBe(403);

    // B's owner can still poll B's conversation from B's origin.
    const ownResponse = messagesGet(
      request(
        { site_key: 'b-widget-key', conversation_id: 'conv-b', visitor_id: 'visitor-b' },
        { origin: 'https://b.example.com' },
      ),
    );
    expect(ownResponse.status).toBe(200);
    expect((await ownResponse.json()).items[0].id).toBe('b-agent');

    const bAdmin = await (
      await listRoute(
        new NextRequest('http://localhost/api/admin/conversations', {
          headers: { cookie: adminSessionCookie({ id: OWNER_B, username: 'beta' }) },
        }),
      )
    ).json();
    expect(bAdmin.items.map((item: { id: string }) => item.id)).toEqual(['conv-b']);
  });

  it('rejects foreign origins before reading anything', async () => {
    seedConversation();
    const response = messagesGet(request(QUERY, { origin: 'https://evil.example.com' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();

    // A request without an Origin is not a browser cross-site request; the
    // visitor id still has to match.
    expect(messagesGet(request(QUERY)).status).toBe(200);
  });

  it('validates required and malformed parameters', async () => {
    seedConversation();
    expect(messagesGet(request({ conversation_id: 'conv-a', visitor_id: 'visitor-a' })).status).toBe(400);
    expect(messagesGet(request({ site_key: 'a-widget-key', visitor_id: 'visitor-a' })).status).toBe(400);
    expect(messagesGet(request({ site_key: 'a-widget-key', conversation_id: 'conv-a' })).status).toBe(400);
    expect(messagesGet(request({ ...QUERY, site_key: 'unknown' })).status).toBe(404);

    for (const after of ['not-a-date', 'x'.repeat(201)]) {
      const response = messagesGet(request({ ...QUERY, after }, { origin: 'https://a.example.com' }));
      expect(response.status, after).toBe(400);
      expect((await response.json()).error).toBe('invalid_after');
    }
  });

  it('rate limits like chat, with CORS headers on the 429', async () => {
    const site = seedConversation();
    updateSite(db(), OWNER_A, site.id, { rateLimitPerMin: 2 });

    const first = messagesGet(request(QUERY, { origin: 'https://a.example.com' }));
    const second = messagesGet(request(QUERY, { origin: 'https://a.example.com' }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const blocked = messagesGet(request(QUERY, { origin: 'https://a.example.com' }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe('rate_limited');
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(blocked.headers.get('access-control-allow-origin')).toBe('https://a.example.com');

    // Another IP has its own bucket.
    expect(
      messagesGet(
        request(QUERY, {
          origin: 'https://a.example.com',
          'x-forwarded-for': '203.0.113.10',
        }),
      ).status,
    ).toBe(200);
  });

  it('accepts an admin reply end to end and exposes it to the widget', async () => {
    seedConversation();
    const before = await (
      await messagesGet(
        request({ ...QUERY, after: '2024-01-01T00:00:03.000Z' }, { origin: 'https://a.example.com' }),
      )
    ).json();
    expect(before.items).toEqual([]);

    const reply = await replyRoute(
      new NextRequest('http://localhost/api/admin/conversations/conv-a/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
        body: JSON.stringify({ content: '刚刚的回复' }),
      }),
      { params: { id: 'conv-a' } },
    );
    expect(reply.status).toBe(201);

    const after = await (
      await messagesGet(
        request({ ...QUERY, after: '2024-01-01T00:00:03.000Z' }, { origin: 'https://a.example.com' }),
      )
    ).json();
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ role: 'agent', content: '刚刚的回复' });
  });

  it('answers OPTIONS preflight per site', () => {
    seedConversation();
    const allowed = messagesOptions(
      new NextRequest('http://localhost/api/widget/messages?site_key=a-widget-key', {
        method: 'OPTIONS',
        headers: { origin: 'https://a.example.com' },
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://a.example.com');

    const evil = messagesOptions(
      new NextRequest('http://localhost/api/widget/messages?site_key=a-widget-key', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example.com' },
      }),
    );
    expect(evil.status).toBe(403);
  });
});

describe('GET /api/widget/config welcome message (F5)', () => {
  it('returns the configured welcome message and nothing when empty', async () => {
    seedConversation();
    const empty = await (
      await configGet(
        new NextRequest('http://localhost/api/widget/config?site_key=a-widget-key', {
          headers: { origin: 'https://a.example.com' },
        }),
      )
    ).json();
    expect(empty.welcomeMessage).toBe('');

    const site = db()
      .prepare('SELECT id FROM sites WHERE site_key = ?')
      .get('a-widget-key') as { id: number };
    updateSite(db(), OWNER_A, site.id, { welcomeMessage: '您好，欢迎咨询！' });

    const body = await (
      await configGet(
        new NextRequest('http://localhost/api/widget/config?site_key=a-widget-key', {
          headers: { origin: 'https://a.example.com' },
        }),
      )
    ).json();
    expect(body.welcomeMessage).toBe('您好，欢迎咨询！');
  });
});
