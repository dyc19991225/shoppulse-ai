import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCopyHistory,
  addMessage,
  createConversation,
  createKbEntry,
  createProduct,
  createSite,
  DEFAULT_SITE_KEY,
  getSiteByKey,
  type DB,
} from '@/lib/db';
import {
  getReportSummary,
  normalizeQuestion,
  reportSummaryCsv,
  REPORT_RANGES,
} from '@/lib/reports';
import { resetDbCache } from '@/lib/db-runtime';
import { GET as summaryRoute } from '@/app/api/admin/reports/summary/route';
import { GET as summaryCsvRoute } from '@/app/api/admin/reports/summary.csv/route';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

/**
 * Reports aggregate a seeded two-user fixture with exact expected numbers:
 * fixed timestamps, UTC day buckets, zero-filled days, owner isolation and the
 * CSV export.
 */

const USER_A = 1;
const USER_B = 2;
/** Injectable clock used by the library tests. */
const NOW = new Date('2026-11-02T12:00:00.000Z');

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
    .run(USER_B, NOW.toISOString());
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

function setConversation(
  id: string,
  startedAt: string,
  options: { needsHuman?: boolean; handled?: boolean } = {},
) {
  db()
    .prepare('UPDATE conversations SET started_at = ?, last_at = ?, needs_human = ?, handled = ? WHERE id = ?')
    .run(startedAt, startedAt, options.needsHuman ? 1 : 0, options.handled ? 1 : 0, id);
}

function addCopy(id: string, ownerId: number, createdAt: string) {
  addCopyHistory(db(), ownerId, { id, params: {}, outputs: {} });
  db().prepare('UPDATE copy_history SET created_at = ? WHERE id = ?').run(createdAt, id);
}

/** Owner A: three in-range conversations (one handoff with an agent reply), one old. */
function seedUserA() {
  const site1 = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
  const site2 = createSite(db(), USER_A, {
    name: '独立站',
    siteKey: 'a-second-site',
    allowedOrigins: [],
    rateLimitPerMin: 30,
  });

  // c1: today, handoff, first agent reply 120s after the first visitor message.
  createConversation(db(), USER_A, { id: 'c1', siteId: site1.id, visitorId: 'v1', topIntent: 'price' });
  setConversation('c1', '2026-11-02T09:00:00.000Z', { needsHuman: true });
  addMessage(db(), USER_A, {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content: '洗碗巾多少钱',
    createdAt: '2026-11-02T09:00:00.000Z',
  });
  addMessage(db(), USER_A, {
    id: 'm2',
    conversationId: 'c1',
    role: 'agent',
    content: '稍等，人工客服马上为您处理',
    createdAt: '2026-11-02T09:02:00.000Z',
  });
  addMessage(db(), USER_A, {
    id: 'm3',
    conversationId: 'c1',
    role: 'assistant',
    content: '参考价 ¥29.90',
    createdAt: '2026-11-02T09:03:00.000Z',
  });
  // c2: first day of the range, handoff handled, no agent reply yet.
  createConversation(db(), USER_A, { id: 'c2', siteId: site2.id, visitorId: 'v2', topIntent: 'after_sale' });
  setConversation('c2', '2026-10-27T08:00:00.000Z', { needsHuman: true, handled: true });
  addMessage(db(), USER_A, {
    id: 'm4',
    conversationId: 'c2',
    role: 'user',
    content: '我要退货',
    createdAt: '2026-10-27T08:00:00.000Z',
  });
  addMessage(db(), USER_A, {
    id: 'm5',
    conversationId: 'c2',
    role: 'assistant',
    content: '好的，请提供订单号',
    createdAt: '2026-10-27T08:00:30.000Z',
  });

  // c4: yesterday, no handoff; two variants of the same normalised question.
  createConversation(db(), USER_A, { id: 'c4', siteId: site1.id, visitorId: 'v4', topIntent: 'price' });
  setConversation('c4', '2026-11-01T10:00:00.000Z');
  addMessage(db(), USER_A, {
    id: 'm6',
    conversationId: 'c4',
    role: 'user',
    content: '有优惠吗',
    createdAt: '2026-11-01T10:00:00.000Z',
  });
  addMessage(db(), USER_A, {
    id: 'm7',
    conversationId: 'c4',
    role: 'user',
    content: ' 有优惠吗 ',
    createdAt: '2026-11-01T10:05:00.000Z',
  });
  addMessage(db(), USER_A, {
    id: 'm8',
    conversationId: 'c4',
    role: 'assistant',
    content: '暂无该信息',
    createdAt: '2026-11-01T10:05:10.000Z',
  });

  // c3 and its message: outside the range entirely.
  createConversation(db(), USER_A, { id: 'c3', siteId: site1.id, visitorId: 'v3', topIntent: 'logistics' });
  setConversation('c3', '2026-10-20T09:00:00.000Z');
  addMessage(db(), USER_A, {
    id: 'm-old',
    conversationId: 'c3',
    role: 'user',
    content: '旧问题',
    createdAt: '2026-10-20T09:00:00.000Z',
  });

  addCopy('h1', USER_A, '2026-11-02T10:00:00.000Z');
  addCopy('h2', USER_A, '2026-10-28T10:00:00.000Z');
  addCopy('h3', USER_A, '2026-10-01T10:00:00.000Z');

  createKbEntry(db(), USER_A, { title: 'A 政策', content: 'A only' });
  createKbEntry(db(), USER_A, { title: 'A FAQ', content: 'A only FAQ' });
  createProduct(db(), USER_A, { name: 'A 商品一', price: 10 });
  createProduct(db(), USER_A, { name: 'A 商品二', price: 20 });

  return { site1, site2 };
}

/** Owner B: one in-range conversation that must never leak into A's report. */
function seedUserB() {
  const site = createSite(db(), USER_B, {
    name: 'B 站点',
    siteKey: 'b-report-site',
    allowedOrigins: [],
    rateLimitPerMin: 30,
  });
  createConversation(db(), USER_B, { id: 'b-conv', siteId: site.id, visitorId: 'bv', topIntent: 'complaint' });
  setConversation('b-conv', '2026-11-02T08:00:00.000Z', { needsHuman: true, handled: true });
  addMessage(db(), USER_B, {
    id: 'b-m1',
    conversationId: 'b-conv',
    role: 'user',
    content: 'B only question',
    createdAt: '2026-11-02T08:00:00.000Z',
  });
  addMessage(db(), USER_B, {
    id: 'b-m2',
    conversationId: 'b-conv',
    role: 'assistant',
    content: 'B only answer',
    createdAt: '2026-11-02T08:00:05.000Z',
  });
  addCopy('b-h1', USER_B, '2026-11-02T08:10:00.000Z');
  createKbEntry(db(), USER_B, { title: 'B 政策', content: 'B only' });
  createProduct(db(), USER_B, { name: 'B 商品', price: 30 });
  return site;
}

describe('getReportSummary', () => {
  it('returns exact aggregates for the seeded owner', () => {
    const { site1, site2 } = seedUserA();
    seedUserB();

    const summary = getReportSummary(db(), USER_A, 7, { now: NOW });

    expect(summary.range).toEqual({
      from: '2026-10-27T00:00:00.000Z',
      to: '2026-11-02T23:59:59.999Z',
      days: 7,
    });
    expect(summary.kpis).toEqual({
      conversations: 3,
      messages: 8,
      visitorMessages: 4,
      aiReplies: 3,
      agentReplies: 1,
      handoffs: 2,
      handoffRate: 2 / 3,
      handled: 1,
      pendingHandoffs: 1,
      copiesGenerated: 2,
      kbEntries: 2,
      products: 2,
      // c1 only: first agent 09:02 minus first visitor 09:00.
      avgAgentFirstResponseSec: 120,
    });
    expect(summary.today).toEqual({ conversations: 1, pendingHandoffs: 1 });

    expect(summary.daily).toEqual([
      { date: '2026-10-27', conversations: 1, messages: 2, handoffs: 1, copies: 0 },
      { date: '2026-10-28', conversations: 0, messages: 0, handoffs: 0, copies: 1 },
      { date: '2026-10-29', conversations: 0, messages: 0, handoffs: 0, copies: 0 },
      { date: '2026-10-30', conversations: 0, messages: 0, handoffs: 0, copies: 0 },
      { date: '2026-10-31', conversations: 0, messages: 0, handoffs: 0, copies: 0 },
      { date: '2026-11-01', conversations: 1, messages: 3, handoffs: 0, copies: 0 },
      { date: '2026-11-02', conversations: 1, messages: 3, handoffs: 1, copies: 1 },
    ]);

    const intents = Object.fromEntries(summary.intents.map((item) => [item.intent, item.count]));
    expect(intents).toMatchObject({ price: 2, after_sale: 1 });
    expect(intents.logistics).toBe(0);
    expect(summary.intents).toHaveLength(7);
    expect(summary.intents.reduce((sum, item) => sum + item.count, 0)).toBe(3);

    const questions = Object.fromEntries(summary.topQuestions.map((item) => [item.text, item.count]));
    expect(questions).toEqual({ 有优惠吗: 2, 洗碗巾多少钱: 1, 我要退货: 1 });
    expect(summary.topQuestions[0]).toEqual({ text: '有优惠吗', count: 2 });

    expect(summary.sites).toEqual([
      { id: site1.id, name: '默认站点', conversations: 2 },
      { id: site2.id, name: '独立站', conversations: 1 },
    ]);
  });

  it('isolates each owner and stays null-safe without agent replies', () => {
    seedUserA();
    const bSite = seedUserB();

    const forB = getReportSummary(db(), USER_B, 7, { now: NOW });
    expect(forB.kpis).toMatchObject({
      conversations: 1,
      messages: 2,
      visitorMessages: 1,
      aiReplies: 1,
      agentReplies: 0,
      handoffs: 1,
      handoffRate: 1,
      handled: 1,
      pendingHandoffs: 0,
      copiesGenerated: 1,
      kbEntries: 1,
      products: 1,
      avgAgentFirstResponseSec: null,
    });
    expect(forB.daily.find((row) => row.date === '2026-11-02')).toEqual({
      date: '2026-11-02',
      conversations: 1,
      messages: 2,
      handoffs: 1,
      copies: 1,
    });
    expect(forB.topQuestions).toEqual([{ text: 'B only question', count: 1 }]);
    expect(forB.sites).toEqual([{ id: bSite.id, name: 'B 站点', conversations: 1 }]);

    // A's counts are unaffected by B's rows.
    const forA = getReportSummary(db(), USER_A, 7, { now: NOW });
    expect(forA.kpis.conversations).toBe(3);
    expect(forA.kpis.messages).toBe(8);
    expect(forA.topQuestions.map((item) => item.text)).not.toContain('B only question');
  });

  it('zero-fills every day and returns empty aggregates with no data', () => {
    const summary = getReportSummary(db(), USER_A, 30, { now: NOW });
    expect(summary.range.days).toBe(30);
    expect(summary.range.from).toBe('2026-10-04T00:00:00.000Z');
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily[0].date).toBe('2026-10-04');
    expect(summary.daily[29].date).toBe('2026-11-02');
    expect(summary.daily.every((row) => row.messages === 0 && row.copies === 0)).toBe(true);
    expect(summary.kpis).toMatchObject({
      conversations: 0,
      messages: 0,
      handoffs: 0,
      handoffRate: 0,
      pendingHandoffs: 0,
      copiesGenerated: 0,
      kbEntries: 0,
      products: 0,
      avgAgentFirstResponseSec: null,
    });
    expect(summary.today).toEqual({ conversations: 0, pendingHandoffs: 0 });
    expect(summary.intents).toHaveLength(7);
    expect(summary.topQuestions).toEqual([]);
    // The owner's site is listed with a real zero count.
    expect(summary.sites).toEqual([{ id: 1, name: '默认站点', conversations: 0 }]);
  });

  it('counts all supported ranges and normalises questions', () => {
    seedUserA();
    for (const days of REPORT_RANGES) {
      const summary = getReportSummary(db(), USER_A, days, { now: NOW });
      expect(summary.daily).toHaveLength(days);
      expect(summary.range.days).toBe(days);
    }
    expect(normalizeQuestion('  有 优惠　吗  ')).toBe('有 优惠 吗');
  });

  it('serialises daily rows as CSV', () => {
    seedUserA();
    const csv = reportSummaryCsv(getReportSummary(db(), USER_A, 7, { now: NOW }));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('date,conversations,messages,handoffs,copies');
    expect(lines).toHaveLength(8);
    expect(lines[1]).toBe('2026-10-27,1,2,1,0');
    expect(lines[7]).toBe('2026-11-02,1,3,1,1');
  });
});

// ---------------------------------------------------------------------------
// Routes (against the real clock, so timestamps are relative to "now")
// ---------------------------------------------------------------------------

function authed(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: adminSessionCookie() },
  });
}

function seedRouteFixture() {
  const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
  const nowIso = new Date().toISOString();
  createConversation(db(), USER_A, { id: 'today', siteId: site.id, topIntent: 'price' });
  db()
    .prepare('UPDATE conversations SET started_at = ?, last_at = ?, needs_human = 1 WHERE id = ?')
    .run(nowIso, nowIso, 'today');
  addMessage(db(), USER_A, {
    id: 'today-m1',
    conversationId: 'today',
    role: 'user',
    content: '今天有货吗',
    createdAt: nowIso,
  });
  addCopy('today-h', USER_A, nowIso);
}

describe('GET /api/admin/reports/summary', () => {
  it('defaults to 7 days and accepts 30 / 90', async () => {
    seedRouteFixture();

    const defaulted = await summaryRoute(authed('/api/admin/reports/summary'));
    expect(defaulted.status).toBe(200);
    const body = await defaulted.json();
    expect(body.range.days).toBe(7);
    expect(body.daily).toHaveLength(7);
    expect(body.today.conversations).toBe(1);
    expect(body.kpis.copiesGenerated).toBe(1);

    for (const days of [30, 90]) {
      const response = await summaryRoute(authed(`/api/admin/reports/summary?days=${days}`));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.range.days).toBe(days);
      expect(payload.daily).toHaveLength(days);
    }
  });

  it('rejects any other days value', async () => {
    for (const query of ['days=8', 'days=0', 'days=-7', 'days=abc', 'days=7.5', 'days=']) {
      const response = await summaryRoute(authed(`/api/admin/reports/summary?${query}`));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toBe('invalid_days');
    }
  });

  it('requires a session', async () => {
    const response = await summaryRoute(
      new NextRequest('http://localhost/api/admin/reports/summary'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/admin/reports/summary.csv', () => {
  it('exports the zero-filled daily rows', async () => {
    seedRouteFixture();
    const response = await summaryCsvRoute(authed('/api/admin/reports/summary.csv?days=7'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const lines = (await response.text()).trimEnd().split('\n');
    expect(lines[0]).toBe('date,conversations,messages,handoffs,copies');
    expect(lines).toHaveLength(8);
    expect(lines[7].startsWith(`${new Date().toISOString().slice(0, 10)},1,1,1,1`)).toBe(true);
  });

  it('rejects invalid days values', async () => {
    for (const days of ['1', '31', 'abc']) {
      const response = await summaryCsvRoute(
        authed(`/api/admin/reports/summary.csv?days=${days}`),
      );
      expect(response.status, days).toBe(400);
    }
  });
});
