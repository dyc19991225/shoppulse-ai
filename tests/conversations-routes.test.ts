import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listRoute } from '@/app/api/admin/conversations/route';
import { GET as detailRoute, PUT as updateRoute } from '@/app/api/admin/conversations/[id]/route';
import {
  addMessage,
  createConversation,
  createSite,
  getSiteByKey,
  DEFAULT_SITE_KEY,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

let temp: TempDb | undefined;

/** Bootstrap admin that owns data in a fresh test database. */
const OWNER = 1;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  resetDbCache();
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

function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: adminSessionCookie() },
  });
}

function seedConversations() {
  const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
  const second = createSite(db(), OWNER, {
    name: '独立站',
    siteKey: 'second-site-key',
    allowedOrigins: ['https://shop.example.com'],
    rateLimitPerMin: 20,
  });

  createConversation(db(), OWNER, { id: 'c1', siteId: site.id, visitorId: 'v1', topIntent: 'price' });
  createConversation(db(), OWNER, { id: 'c2', siteId: second.id, visitorId: 'v2', topIntent: 'after_sale' });
  updateHandled('c2', true);
  db().prepare('UPDATE conversations SET needs_human = 1 WHERE id = ?').run('c2');

  addMessage(db(), OWNER, { id: 'm1', conversationId: 'c1', role: 'user', content: '这个多少钱？', intent: 'price' });
  addMessage(db(), OWNER, { id: 'm2', conversationId: 'c1', role: 'assistant', content: '参考价 ¥29.90。' });
  addMessage(db(), OWNER, { id: 'm3', conversationId: 'c2', role: 'user', content: '我要退货' });
  return { site, second };
}

function updateHandled(id: string, handled: boolean) {
  db().prepare('UPDATE conversations SET handled = ? WHERE id = ?').run(handled ? 1 : 0, id);
}

describe('GET /api/admin/conversations', () => {
  it('lists conversations with site name and message count', async () => {
    seedConversations();
    const response = await listRoute(getRequest('/api/admin/conversations'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    const c1 = body.items.find((item: { id: string }) => item.id === 'c1');
    expect(c1).toMatchObject({
      siteName: '默认站点',
      visitorId: 'v1',
      topIntent: 'price',
      messageCount: 2,
      handled: false,
      needsHuman: false,
    });
  });

  it('filters by site, handled and needs-human', async () => {
    const { second } = seedConversations();

    const bySite = await (
      await listRoute(getRequest(`/api/admin/conversations?siteId=${second.id}`))
    ).json();
    expect(bySite.total).toBe(1);
    expect(bySite.items[0].id).toBe('c2');

    const handled = await (
      await listRoute(getRequest('/api/admin/conversations?handled=true'))
    ).json();
    expect(handled.items.map((item: { id: string }) => item.id)).toEqual(['c2']);

    const unhandled = await (
      await listRoute(getRequest('/api/admin/conversations?handled=false'))
    ).json();
    expect(unhandled.items.map((item: { id: string }) => item.id)).toEqual(['c1']);

    const needsHuman = await (
      await listRoute(getRequest('/api/admin/conversations?needsHuman=true'))
    ).json();
    expect(needsHuman.items.map((item: { id: string }) => item.id)).toEqual(['c2']);
  });

  it('paginates', async () => {
    seedConversations();
    const first = await (
      await listRoute(getRequest('/api/admin/conversations?limit=1&offset=0'))
    ).json();
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(2);

    const second = await (
      await listRoute(getRequest('/api/admin/conversations?limit=1&offset=1'))
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it('rejects invalid query params', async () => {
    for (const query of [
      'siteId=abc',
      'handled=maybe',
      'needsHuman=1',
      'limit=0',
      'limit=201',
      'offset=-1',
    ]) {
      const response = await listRoute(getRequest(`/api/admin/conversations?${query}`));
      expect(response.status, query).toBe(400);
    }
  });
});

describe('conversation detail API', () => {
  it('returns metadata and the transcript in order', async () => {
    seedConversations();
    const response = await detailRoute(getRequest('/'), params('c1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item).toMatchObject({ id: 'c1', siteName: '默认站点', messageCount: 2 });
    expect(body.messages.map((message: { id: string }) => message.id)).toEqual(['m1', 'm2']);
    expect(body.messages[1].content).toContain('29.90');
  });

  it('404s for unknown conversations', async () => {
    expect((await detailRoute(getRequest('/'), params('missing'))).status).toBe(404);
  });

  it('marks handled and unhandled', async () => {
    seedConversations();

    const handled = await updateRoute(
      new NextRequest('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
        body: JSON.stringify({ handled: true }),
      }),
      params('c1'),
    );
    expect(handled.status).toBe(200);
    expect(await handled.json()).toEqual({ ok: true, handled: true });
    expect(await detailRoute(getRequest('/'), params('c1'))).toBeDefined();

    const detail = await (await detailRoute(getRequest('/'), params('c1'))).json();
    expect(detail.item.handled).toBe(true);

    const unhandled = await updateRoute(
      new NextRequest('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
        body: JSON.stringify({ handled: false }),
      }),
      params('c1'),
    );
    expect(unhandled.status).toBe(200);
    const after = await (await detailRoute(getRequest('/'), params('c1'))).json();
    expect(after.item.handled).toBe(false);
  });

  it('validates the update body and id', async () => {
    seedConversations();
    const badBodies = ['{nope', JSON.stringify({ handled: 'yes' }), JSON.stringify({})];
    for (const body of badBodies) {
      const response = await updateRoute(
        new NextRequest('http://localhost', {
          method: 'PUT',
          headers: { cookie: adminSessionCookie() },
          body,
        }),
        params('c1'),
      );
      expect(response.status, body).toBe(400);
    }

    const missing = await updateRoute(
      new NextRequest('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
        body: JSON.stringify({ handled: true }),
      }),
      params('missing'),
    );
    expect(missing.status).toBe(404);
  });
});
