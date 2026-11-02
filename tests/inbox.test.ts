import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listRoute } from '@/app/api/admin/conversations/route';
import {
  GET as detailRoute,
  PATCH as patchRoute,
} from '@/app/api/admin/conversations/[id]/route';
import { POST as replyRoute } from '@/app/api/admin/conversations/[id]/messages/route';
import {
  addMessage,
  createConversation,
  createSite,
  getConversation,
  listMessages,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import {
  buildKbDraftFromConversation,
  normalizeTags,
  validateAgentMessageContent,
} from '@/lib/inbox';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

/**
 * F3 inbox: agent replies, tags/note PATCH, ?tag= filtering and strict
 * per-owner isolation on every new route. F4's KB prefill helper is covered at
 * the bottom.
 */

const USER_A = 1;
const USER_B = 2;
const USER_1 = { id: USER_A, username: 'admin' };
const USER_2 = { id: USER_B, username: 'beta' };

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  resetDbCache();

  temp.db
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
       VALUES (?, 'beta', '', 'user', 0, 0, ?)`,
    )
    .run(USER_B, new Date().toISOString());
});

afterEach(() => {
  resetDbCache();
  vi.unstubAllEnvs();
  temp?.cleanup();
  temp = undefined;
});

function db(): DB {
  return temp!.db;
}

function params(id: string) {
  return { params: { id } };
}

/** Request signed in as `user`, optionally with a JSON body. */
function as(
  user: { id: number; username: string },
  url: string,
  init: { method?: string; body?: unknown } = {},
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie: adminSessionCookie(user),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Seeds one conversation per owner: A owns site-a / conv-a, B site-b / conv-b. */
function seedTwoOwners() {
  const siteA = createSite(db(), USER_A, {
    name: 'A site',
    siteKey: 'a-site-key',
    allowedOrigins: ['https://a.example.com'],
    rateLimitPerMin: 30,
  });
  const siteB = createSite(db(), USER_B, {
    name: 'B site',
    siteKey: 'b-site-key',
    allowedOrigins: ['https://b.example.com'],
    rateLimitPerMin: 30,
  });
  createConversation(db(), USER_A, {
    id: 'conv-a',
    siteId: siteA.id,
    visitorId: 'visitor-a',
    topIntent: 'price',
  });
  createConversation(db(), USER_B, {
    id: 'conv-b',
    siteId: siteB.id,
    visitorId: 'visitor-b',
    topIntent: 'after_sale',
  });
  addMessage(db(), USER_A, { id: 'a-u1', conversationId: 'conv-a', role: 'user', content: '多少钱？' });
  addMessage(db(), USER_A, { id: 'a-a1', conversationId: 'conv-a', role: 'assistant', content: '¥29.90。' });
  addMessage(db(), USER_B, { id: 'b-u1', conversationId: 'conv-b', role: 'user', content: 'B only' });
  return { siteA, siteB };
}

describe('inbox validation helpers', () => {
  it('trims agent replies and enforces 1–2000 characters', () => {
    expect(validateAgentMessageContent('  您好  ')).toBe('您好');
    expect(validateAgentMessageContent('x'.repeat(2000))).toBe('x'.repeat(2000));
    expect(validateAgentMessageContent('x'.repeat(2001))).toBeNull();
    for (const bad of ['', '   ', 42, null, undefined, {}]) {
      expect(validateAgentMessageContent(bad)).toBeNull();
    }
  });

  it('trims, de-duplicates and bounds tags', () => {
    expect(normalizeTags([' VIP ', 'VIP', '售后', '售后'])).toEqual(['VIP', '售后']);
    expect(normalizeTags([])).toEqual([]);
    expect(normalizeTags(Array.from({ length: 10 }, (_, index) => `t${index}`))).toHaveLength(10);
    for (const bad of [
      'vip',
      [1],
      [''],
      ['  '],
      ['x'.repeat(21)],
      Array.from({ length: 11 }, (_, index) => `t${index}`),
    ]) {
      expect(normalizeTags(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('POST /api/admin/conversations/[id]/messages', () => {
  it('stores an agent reply and updates last_at', async () => {
    seedTwoOwners();
    db().prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      'conv-a',
    );

    const response = await replyRoute(
      as(USER_1, '/', { method: 'POST', body: { content: '  已为您登记，稍后处理。  ' } }),
      params('conv-a'),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({
      conversationId: 'conv-a',
      role: 'agent',
      content: '已为您登记，稍后处理。',
    });

    const conversation = getConversation(db(), USER_A, 'conv-a')!;
    expect(conversation.lastAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(conversation.handled).toBe(false);
    expect(listMessages(db(), USER_A, 'conv-a').at(-1)).toMatchObject({
      role: 'agent',
      content: '已为您登记，稍后处理。',
    });
  });

  it('optionally marks the conversation handled', async () => {
    seedTwoOwners();
    const response = await replyRoute(
      as(USER_1, '/', {
        method: 'POST',
        body: { content: '已解决', markHandled: true },
      }),
      params('conv-a'),
    );
    expect(response.status).toBe(201);
    expect(getConversation(db(), USER_A, 'conv-a')!.handled).toBe(true);
  });

  it('validates content, markHandled, id and JSON', async () => {
    seedTwoOwners();
    const bodies: unknown[] = [
      {},
      { content: '' },
      { content: '   ' },
      { content: 'x'.repeat(2001) },
      { content: 42 },
      { content: 'ok', markHandled: 'yes' },
    ];
    for (const body of bodies) {
      const response = await replyRoute(
        as(USER_1, '/', { method: 'POST', body }),
        params('conv-a'),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    const badJson = await replyRoute(
      new NextRequest('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie(USER_1) },
        body: '{nope',
      }),
      params('conv-a'),
    );
    expect(badJson.status).toBe(400);

    const missing = await replyRoute(
      as(USER_1, '/', { method: 'POST', body: { content: 'hi' } }),
      params('missing'),
    );
    expect(missing.status).toBe(404);
    expect(listMessages(db(), USER_A, 'conv-a')).toHaveLength(2);
  });

  it('treats another owner as not found and writes nothing', async () => {
    seedTwoOwners();
    const response = await replyRoute(
      as(USER_2, '/', { method: 'POST', body: { content: 'hijack', markHandled: true } }),
      params('conv-a'),
    );
    expect(response.status).toBe(404);
    expect(listMessages(db(), USER_A, 'conv-a')).toHaveLength(2);
    expect(getConversation(db(), USER_A, 'conv-a')!.handled).toBe(false);

    const reverse = await replyRoute(
      as(USER_1, '/', { method: 'POST', body: { content: 'hijack' } }),
      params('conv-b'),
    );
    expect(reverse.status).toBe(404);
    expect(listMessages(db(), USER_B, 'conv-b')).toHaveLength(1);

    // B can still reply to its own conversation.
    const own = await replyRoute(
      as(USER_2, '/', { method: 'POST', body: { content: 'B reply' } }),
      params('conv-b'),
    );
    expect(own.status).toBe(201);
    expect((await own.json()).item.role).toBe('agent');
  });
});

describe('PATCH /api/admin/conversations/[id]', () => {
  it('updates tags, note and handled, returning the conversation', async () => {
    seedTwoOwners();
    const response = await patchRoute(
      as(USER_1, '/', {
        method: 'PATCH',
        body: { tags: [' VIP ', '售后', 'VIP'], note: '客户要求尽快', handled: true },
      }),
      params('conv-a'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({
      id: 'conv-a',
      tags: ['VIP', '售后'],
      note: '客户要求尽快',
      handled: true,
    });

    const detail = await (await detailRoute(as(USER_1, '/'), params('conv-a'))).json();
    expect(detail.item).toMatchObject({ tags: ['VIP', '售后'], note: '客户要求尽快', handled: true });
  });

  it('allows clearing tags/note and handles fields independently', async () => {
    seedTwoOwners();
    db().prepare("UPDATE conversations SET tags = '[\"VIP\"]', note = 'old' WHERE id = 'conv-a'").run();

    const cleared = await patchRoute(
      as(USER_1, '/', { method: 'PATCH', body: { tags: [], note: '' } }),
      params('conv-a'),
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).item).toMatchObject({ tags: [], note: '', handled: false });

    const handled = await patchRoute(
      as(USER_1, '/', { method: 'PATCH', body: { handled: true } }),
      params('conv-a'),
    );
    expect(handled.status).toBe(200);
    expect((await handled.json()).item).toMatchObject({ tags: [], handled: true });
  });

  it('validates tags, note, handled and empty payloads', async () => {
    seedTwoOwners();
    const bodies: unknown[] = [
      {},
      { tags: 'VIP' },
      { tags: [''] },
      { tags: ['x'.repeat(21)] },
      { tags: Array.from({ length: 11 }, (_, index) => `t${index}`) },
      { note: 1 },
      { note: 'x'.repeat(2001) },
      { handled: 'yes' },
    ];
    for (const body of bodies) {
      const response = await patchRoute(
        as(USER_1, '/', { method: 'PATCH', body }),
        params('conv-a'),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toBeTruthy();
    }

    const badJson = await patchRoute(
      new NextRequest('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie(USER_1) },
        body: '{nope',
      }),
      params('conv-a'),
    );
    expect(badJson.status).toBe(400);

    const boundary = await patchRoute(
      as(USER_1, '/', {
        method: 'PATCH',
        body: { tags: ['x'.repeat(20)], note: 'y'.repeat(2000) },
      }),
      params('conv-a'),
    );
    expect(boundary.status).toBe(200);

    const missing = await patchRoute(
      as(USER_1, '/', { method: 'PATCH', body: { tags: ['VIP'] } }),
      params('missing'),
    );
    expect(missing.status).toBe(404);
  });

  it('treats another owner as not found and leaves the row untouched', async () => {
    seedTwoOwners();
    for (const body of [
      { tags: ['hijack'] },
      { note: 'hijack' },
      { handled: true },
      { tags: [], note: '', handled: true },
    ]) {
      const response = await patchRoute(
        as(USER_2, '/', { method: 'PATCH', body }),
        params('conv-a'),
      );
      expect(response.status, JSON.stringify(body)).toBe(404);
    }

    const conversation = getConversation(db(), USER_A, 'conv-a')!;
    expect(conversation).toMatchObject({ tags: [], note: '', handled: false });
    expect(
      (await patchRoute(as(USER_1, '/', { method: 'PATCH', body: { tags: ['A'] } }), params('conv-b')))
        .status,
    ).toBe(404);
    expect(getConversation(db(), USER_B, 'conv-b')!.tags).toEqual([]);
  });
});

describe('GET /api/admin/conversations?tag=', () => {
  it('filters by an exact tag', async () => {
    seedTwoOwners();
    db().prepare("UPDATE conversations SET tags = '[\"VIP\",\"售后\"]' WHERE id = 'conv-a'").run();
    db().prepare("UPDATE conversations SET tags = '[\"VIP\"]' WHERE id = 'conv-b'").run();

    const aVip = await (await listRoute(as(USER_1, '/?tag=VIP'))).json();
    expect(aVip.total).toBe(1);
    expect(aVip.items.map((item: { id: string }) => item.id)).toEqual(['conv-a']);
    expect(aVip.items[0].tags).toEqual(['VIP', '售后']);

    const aAfterSale = await (await listRoute(as(USER_1, '/?tag=%E5%94%AE%E5%90%8E'))).json();
    expect(aAfterSale.items.map((item: { id: string }) => item.id)).toEqual(['conv-a']);

    const bVip = await (await listRoute(as(USER_2, '/?tag=VIP'))).json();
    expect(bVip.items.map((item: { id: string }) => item.id)).toEqual(['conv-b']);

    const none = await (await listRoute(as(USER_1, '/?tag=missing'))).json();
    expect(none).toEqual({ items: [], total: 0 });
  });

  it('rejects an empty or oversized tag', async () => {
    seedTwoOwners();
    for (const query of ['tag=', 'tag=%20%20', `tag=${'x'.repeat(21)}`]) {
      const response = await listRoute(as(USER_1, `/?${query}`));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toBe('invalid_tag');
    }
  });

  it('includes default tags/note on conversations seeded before F3', async () => {
    seedTwoOwners();
    const body = await (await listRoute(as(USER_1, '/'))).json();
    expect(body.items[0]).toMatchObject({ tags: [], note: '' });
  });
});

describe('agent messages in the admin transcript', () => {
  it('returns agent messages in order with the rest of the conversation', async () => {
    seedTwoOwners();
    addMessage(db(), USER_A, {
      id: 'a-agent',
      conversationId: 'conv-a',
      role: 'agent',
      content: '您好，我是人工客服。',
      // The seeded messages use nowIso(); a far-future stamp keeps order stable.
      createdAt: '2999-01-01T00:00:03.000Z',
    });
    const body = await (await detailRoute(as(USER_1, '/'), params('conv-a'))).json();
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
      'agent',
    ]);
    expect(body.item.messageCount).toBe(3);
  });
});

describe('buildKbDraftFromConversation (F4)', () => {
  const base = {
    conversationId: 'c',
    intent: '',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  it('uses the visitor question and the following AI reply', () => {
    const messages = [
      { ...base, id: '1', role: 'user' as const, content: ' 支持退货吗？ ' },
      { ...base, id: '2', role: 'assistant' as const, content: ' 签收后 7 天内可退。 ' },
      { ...base, id: '3', role: 'agent' as const, content: '人工补充' },
    ];
    expect(buildKbDraftFromConversation(messages, 0)).toEqual({
      title: '支持退货吗？',
      content: '签收后 7 天内可退。',
    });
  });

  it('uses a following agent reply when no AI reply exists', () => {
    const messages = [
      { ...base, id: '1', role: 'user' as const, content: '发货多久？' },
      { ...base, id: '2', role: 'agent' as const, content: '48 小时内发货。' },
    ];
    expect(buildKbDraftFromConversation(messages, 0)?.content).toBe('48 小时内发货。');
  });

  it('leaves the answer empty when the visitor is still waiting', () => {
    const messages = [{ ...base, id: '1', role: 'user' as const, content: '在吗？' }];
    expect(buildKbDraftFromConversation(messages, 0)).toEqual({ title: '在吗？', content: '' });
  });

  it('returns null for non-visitor messages and out-of-range indexes', () => {
    const messages = [
      { ...base, id: '1', role: 'assistant' as const, content: 'hi' },
      { ...base, id: '2', role: 'user' as const, content: '   ' },
    ];
    expect(buildKbDraftFromConversation(messages, 0)).toBeNull();
    expect(buildKbDraftFromConversation(messages, 1)).toBeNull();
    expect(buildKbDraftFromConversation(messages, 9)).toBeNull();
  });
});
