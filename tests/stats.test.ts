import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStats,
  isTopicTerm,
  STATS_RANGE_DAYS,
  topQuestionTerms,
} from '@/lib/stats';
import {
  addCopyHistory,
  addMessage,
  createConversation,
  createKbEntry,
  createProduct,
  getSiteByKey,
  DEFAULT_SITE_KEY,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { GET as statsRoute } from '@/app/api/admin/stats/route';
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

function seed() {
  const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
  createKbEntry(db(), OWNER, { title: '退换货政策', content: '7 天退货' });
  createProduct(db(), OWNER, { name: '洗碗巾', price: 29.9 });
  addCopyHistory(db(), OWNER, { id: 'h1', params: {}, outputs: {} });

  const intents = ['price', 'price', 'after_sale', 'handoff', 'other'];
  intents.forEach((intent, index) => {
    createConversation(db(), OWNER, {
      id: `c${index}`,
      siteId: site.id,
      visitorId: `v${index}`,
      topIntent: intent,
    });
    addMessage(db(), OWNER, {
      id: `m${index}`,
      conversationId: `c${index}`,
      role: 'user',
      content: ['洗碗巾多少钱', '有优惠吗', '我要退货', '转人工', '你好'][index],
      intent,
    });
  });
  db().prepare('UPDATE conversations SET needs_human = 1 WHERE id IN (?, ?)').run('c2', 'c3');
  db().prepare('UPDATE conversations SET handled = 1 WHERE id = ?').run('c2');
}

describe('getStats', () => {
  it('summarizes totals, 7-day volume, handoffs and intents', () => {
    seed();
    const stats = getStats(db(), OWNER);

    expect(stats.rangeDays).toBe(STATS_RANGE_DAYS);
    expect(stats.totals).toEqual({
      conversations: 5,
      kbEntries: 1,
      products: 1,
      copyHistory: 1,
      sites: 1,
    });
    expect(stats.last7Days).toEqual({ conversations: 5, needsHuman: 2, handled: 1 });
    expect(stats.handoffRate).toBeCloseTo(2 / 5);

    const byIntent = Object.fromEntries(stats.intents.map((item) => [item.intent, item]));
    expect(byIntent.price.count).toBe(2);
    expect(byIntent.price.share).toBeCloseTo(0.4);
    expect(byIntent.after_sale.count).toBe(1);
    expect(stats.intents).toHaveLength(7);
    // Sorted most frequent first.
    expect(stats.intents[0].intent).toBe('price');
    expect(stats.intents.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
  });

  it('counts intents of all conversations in the range', () => {
    seed();
    // A conversation older than the range must not be counted.
    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    createConversation(db(), OWNER, { id: 'old', siteId: site.id, topIntent: 'price' });
    db()
      .prepare('UPDATE conversations SET started_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', 'old');

    const stats = getStats(db(), OWNER);
    expect(stats.last7Days.conversations).toBe(5);
    expect(stats.intents.find((item) => item.intent === 'price')!.count).toBe(2);
    expect(stats.totals.conversations).toBe(6);
  });

  it('returns zeroed shares when there is no data', () => {
    const stats = getStats(db(), OWNER);
    expect(stats.last7Days).toEqual({ conversations: 0, needsHuman: 0, handled: 0 });
    expect(stats.handoffRate).toBe(0);
    expect(stats.intents.every((item) => item.share === 0)).toBe(true);
    expect(stats.topQuestions).toEqual([]);
  });

  it('supports a custom range', () => {
    seed();
    const stats = getStats(db(), OWNER, { rangeDays: 3650 });
    expect(stats.rangeDays).toBe(3650);
    expect(stats.last7Days.conversations).toBe(5);
  });
});

describe('topQuestionTerms', () => {
  it('ranks topic terms and filters stop words', () => {
    seed();
    addMessage(db(), OWNER, {
      id: 'extra-1',
      conversationId: 'c0',
      role: 'user',
      content: '洗碗巾多少钱，请问有优惠吗',
    });
    const terms = topQuestionTerms(db(), OWNER, '2000-01-01T00:00:00.000Z');
    expect(terms.length).toBeGreaterThan(0);
    const byTerm = new Map(terms.map((term) => [term.term, term.count]));
    expect(byTerm.get('洗碗')).toBe(2);
    expect(byTerm.get('优惠')).toBe(2);
    expect(terms[0].count).toBe(2);
    expect(byTerm.has('你好')).toBe(false);
    expect(byTerm.has('多少')).toBe(false);
    // Assistant messages are ignored.
    addMessage(db(), OWNER, {
      id: 'assistant-1',
      conversationId: 'c0',
      role: 'assistant',
      content: '洗碗巾参考价 29.9 元',
    });
    const after = topQuestionTerms(db(), OWNER, '2000-01-01T00:00:00.000Z');
    const afterByTerm = new Map(after.map((term) => [term.term, term.count]));
    expect(afterByTerm.get('洗碗')).toBe(2);
  });

  it('classifies topic terms', () => {
    expect(isTopicTerm('退货')).toBe(true);
    expect(isTopicTerm('洗碗')).toBe(true);
    expect(isTopicTerm('shipping')).toBe(true);
    expect(isTopicTerm('了')).toBe(false);
    expect(isTopicTerm('什么')).toBe(false);
    expect(isTopicTerm('the')).toBe(false);
    expect(isTopicTerm('ab')).toBe(false);
    expect(isTopicTerm('好的')).toBe(false);
  });
});

function statsRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: adminSessionCookie() },
  });
}

describe('GET /api/admin/stats', () => {
  it('returns the stats payload', async () => {
    seed();
    const response = await statsRoute(statsRequest('/api/admin/stats'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.last7Days.conversations).toBe(5);
    expect(body.intents).toHaveLength(7);
    expect(body.topQuestions.length).toBeGreaterThan(0);
  });

  it('accepts a days parameter and rejects invalid ones', async () => {
    const ok = await statsRoute(statsRequest('/api/admin/stats?days=30'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).rangeDays).toBe(30);

    for (const query of ['days=0', 'days=abc', 'days=366', 'days=-1']) {
      expect(
        (await statsRoute(statsRequest(`/api/admin/stats?${query}`))).status,
        query,
      ).toBe(400);
    }
  });
});
