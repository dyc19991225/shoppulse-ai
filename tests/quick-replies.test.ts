import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/quick-replies/route';
import {
  DELETE as deleteRoute,
  GET as getRoute,
  PUT as updateRoute,
} from '@/app/api/admin/quick-replies/[id]/route';
import {
  createQuickReply,
  deleteQuickReply,
  getQuickReply,
  listQuickReplies,
  updateQuickReply,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

/** Quick-reply CRUD: repository, validation and strict per-owner isolation. */

const USER_A = 1;
const USER_B = 2;

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

function params(id: string | number) {
  return { params: { id: String(id) } };
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

const USER_1 = { id: USER_A, username: 'admin' };
const USER_2 = { id: USER_B, username: 'beta' };

describe('quick replies repository', () => {
  it('creates, lists, updates and deletes per owner', () => {
    const created = createQuickReply(db(), USER_A, { title: '问候', content: '您好，请问有什么可以帮您？' });
    expect(created).toMatchObject({ title: '问候', content: '您好，请问有什么可以帮您？' });
    expect(created.id).toBeGreaterThan(0);
    expect(getQuickReply(db(), USER_A, created.id)).toMatchObject({ title: '问候' });

    expect(listQuickReplies(db(), USER_A)).toHaveLength(1);
    expect(listQuickReplies(db(), USER_B)).toHaveLength(0);

    const updated = updateQuickReply(db(), USER_A, created.id, { content: '您好～' });
    expect(updated!.content).toBe('您好～');
    expect(updated!.title).toBe('问候');
    expect(updateQuickReply(db(), USER_B, created.id, { title: 'hijack' })).toBeNull();
    expect(getQuickReply(db(), USER_A, created.id)!.content).toBe('您好～');

    expect(deleteQuickReply(db(), USER_B, created.id)).toBe(false);
    expect(deleteQuickReply(db(), USER_A, created.id)).toBe(true);
    expect(getQuickReply(db(), USER_A, created.id)).toBeNull();
  });

  it('lists newest first', () => {
    const first = createQuickReply(db(), USER_A, { title: 'A', content: 'a' });
    const second = createQuickReply(db(), USER_A, { title: 'B', content: 'b' });
    db().prepare('UPDATE quick_replies SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', first.id);
    db().prepare('UPDATE quick_replies SET updated_at = ? WHERE id = ?').run('2021-01-01T00:00:00.000Z', second.id);
    expect(listQuickReplies(db(), USER_A).map((item) => item.title)).toEqual(['B', 'A']);
  });
});

describe('quick reply API', () => {
  it('creates, lists, reads, updates and deletes', async () => {
    const created = await createRoute(
      as(USER_1, '/api/admin/quick-replies', {
        method: 'POST',
        body: { title: '物流说明', content: '下单后 48 小时内发货。' },
      }),
    );
    expect(created.status).toBe(201);
    const item = (await created.json()).item;
    expect(item).toMatchObject({ title: '物流说明', content: '下单后 48 小时内发货。' });

    const list = await listRoute(as(USER_1, '/api/admin/quick-replies'));
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(item.id);

    const fetched = await getRoute(as(USER_1, '/'), params(item.id));
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).item.title).toBe('物流说明');

    const updated = await updateRoute(
      as(USER_1, '/', { method: 'PUT', body: { title: '发货说明' } }),
      params(item.id),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).item).toMatchObject({
      title: '发货说明',
      content: '下单后 48 小时内发货。',
    });

    const deleted = await deleteRoute(as(USER_1, '/'), params(item.id));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect((await getRoute(as(USER_1, '/'), params(item.id))).status).toBe(404);
    expect((await deleteRoute(as(USER_1, '/'), params(item.id))).status).toBe(404);
  });

  it('validates payloads', async () => {
    const cases: unknown[] = [
      {},
      { title: 'x' },
      { content: 'y' },
      { title: '   ', content: 'y' },
      { title: 'x', content: '   ' },
      { title: 'x'.repeat(101), content: 'y' },
      { title: 'x', content: 'y'.repeat(2001) },
      { title: 1, content: 'y' },
    ];
    for (const body of cases) {
      const response = await createRoute(
        as(USER_1, '/api/admin/quick-replies', { method: 'POST', body }),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    const longContent = await createRoute(
      as(USER_1, '/api/admin/quick-replies', {
        method: 'POST',
        body: { title: '边界值', content: 'y'.repeat(2000) },
      }),
    );
    expect(longContent.status).toBe(201);
    const item = (await longContent.json()).item;

    const badUpdate = await updateRoute(
      as(USER_1, '/', { method: 'PUT', body: { content: '' } }),
      params(item.id),
    );
    expect(badUpdate.status).toBe(400);

    const noUpdates = await updateRoute(
      as(USER_1, '/', { method: 'PUT', body: {} }),
      params(item.id),
    );
    expect(noUpdates.status).toBe(400);

    const badId = await updateRoute(
      as(USER_1, '/', { method: 'PUT', body: { title: 'x' } }),
      params('abc'),
    );
    expect(badId.status).toBe(400);
  });

  it('treats another owner as not found', async () => {
    const created = await createRoute(
      as(USER_1, '/api/admin/quick-replies', {
        method: 'POST',
        body: { title: 'A 专属', content: 'A only' },
      }),
    );
    const item = (await created.json()).item;

    const bList = await listRoute(as(USER_2, '/api/admin/quick-replies'));
    expect((await bList.json()).total).toBe(0);

    expect((await getRoute(as(USER_2, '/'), params(item.id))).status).toBe(404);
    expect(
      (
        await updateRoute(
          as(USER_2, '/', { method: 'PUT', body: { title: 'hijacked' } }),
          params(item.id),
        )
      ).status,
    ).toBe(404);
    expect((await deleteRoute(as(USER_2, '/'), params(item.id))).status).toBe(404);

    // The owner's row is untouched.
    const stillThere = await getRoute(as(USER_1, '/'), params(item.id));
    expect(stillThere.status).toBe(200);
    expect((await stillThere.json()).item.title).toBe('A 专属');

    // B still gets its own independent library.
    const bCreated = await createRoute(
      as(USER_2, '/api/admin/quick-replies', { method: 'POST', body: { title: 'B 专属', content: 'B only' } }),
    );
    expect(bCreated.status).toBe(201);
    const aTitles = (await (await listRoute(as(USER_1, '/api/admin/quick-replies'))).json()).items.map(
      (reply: { title: string }) => reply.title,
    );
    expect(aTitles).toEqual(['A 专属']);
  });

  it('requires a session', async () => {
    const response = await listRoute(new NextRequest('http://localhost/api/admin/quick-replies'));
    expect(response.status).toBe(401);
  });
});
