import { afterEach, describe, expect, it } from 'vitest';
import { createKbEntry, createProduct } from '@/lib/db';
import {
  retrieve,
  retrieveKnowledge,
  retrieveProducts,
  tokenize,
  wantsRecommendation,
} from '@/lib/retrieval';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

/** Bootstrap admin that owns data in a fresh test database. */
const OWNER = 1;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function setup() {
  temp = createTempDb();
  return temp.db;
}

describe('tokenize', () => {
  it('produces CJK bigrams and lower-cased Latin words', () => {
    const tokens = tokenize('退换货 Policy 2024');
    expect(tokens).toContain('退换');
    expect(tokens).toContain('换货');
    expect(tokens).toContain('policy');
    expect(tokens).toContain('2024');
    expect(tokens).not.toContain('退换货');
  });

  it('handles single CJK characters and empty input', () => {
    expect(tokenize('退')).toEqual(['退']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!!')).toEqual([]);
  });

  it('normalizes full-width characters', () => {
    const tokens = tokenize('ＡＢＣ１２３');
    expect(tokens).toContain('abc123');
  });
});

describe('retrieveKnowledge', () => {
  it('ranks title hits above content-only hits', () => {
    const db = setup();
    const titleHit = createKbEntry(db, OWNER, {
      title: '退换货政策',
      content: '其他说明',
      type: 'policy',
    });
    const contentHit = createKbEntry(db, OWNER, {
      title: '店铺介绍',
      content: '我们支持退换货，具体请咨询客服。',
    });

    const results = retrieveKnowledge(db, OWNER, '退换货');
    expect(results[0].item.id).toBe(titleHit.id);
    expect(results.map((r) => r.item.id)).toContain(contentHit.id);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].matched.length).toBeGreaterThan(0);
  });

  it('respects the limit and skips disabled rows', () => {
    const db = setup();
    for (let i = 0; i < 6; i += 1) {
      createKbEntry(db, OWNER, { title: `物流问题 ${i}`, content: '物流说明', keywords: '快递' });
    }
    createKbEntry(db, OWNER, { title: '物流隐藏', content: '物流说明', enabled: false });

    const results = retrieveKnowledge(db, OWNER, '物流', { limit: 4 });
    expect(results).toHaveLength(4);
    expect(results.some((r) => r.item.title === '物流隐藏')).toBe(false);

    const withDisabled = retrieveKnowledge(db, OWNER, '物流隐藏', { enabledOnly: false });
    expect(withDisabled.some((r) => r.item.title === '物流隐藏')).toBe(true);
  });

  it('returns nothing for unmatched or empty queries', () => {
    const db = setup();
    createKbEntry(db, OWNER, { title: '支付说明', content: '支持微信支付宝' });
    expect(retrieveKnowledge(db, OWNER, '火星救援')).toHaveLength(0);
    expect(retrieveKnowledge(db, OWNER, '')).toHaveLength(0);
  });

  it('matches English keywords case-insensitively', () => {
    const db = setup();
    const entry = createKbEntry(db, OWNER, {
      title: 'Shipping',
      content: 'Orders ship within 48 hours.',
      keywords: 'delivery shipping',
    });
    const results = retrieveKnowledge(db, OWNER, 'DELIVERY time');
    expect(results[0]?.item.id).toBe(entry.id);
  });
});

describe('retrieveProducts', () => {
  it('matches by name, category and SKU', () => {
    const db = setup();
    const towel = createProduct(db, OWNER, {
      sku: 'QH-001',
      name: '青禾竹纤维洗碗巾',
      category: '厨房清洁',
      price: 29.9,
      stock: 10,
    });
    createProduct(db, OWNER, { sku: 'QH-002', name: '山茶花洗护套装', category: '洗护', price: 89 });

    expect(retrieveProducts(db, OWNER, '洗碗巾')[0].item.id).toBe(towel.id);
    expect(retrieveProducts(db, OWNER, '洗护')[0].item.sku).toBe('QH-002');
    expect(retrieveProducts(db, OWNER, 'qh-001')[0].item.id).toBe(towel.id);
  });

  it('prefers in-stock items on ties', () => {
    const db = setup();
    createProduct(db, OWNER, { name: '收纳箱 A', stock: 0 });
    const inStock = createProduct(db, OWNER, { name: '收纳箱 B', stock: 50 });
    expect(retrieveProducts(db, OWNER, '收纳箱')[0].item.id).toBe(inStock.id);
  });

  it('falls back to in-stock products only for recommendation questions', () => {
    const db = setup();
    createProduct(db, OWNER, { name: '苹果', stock: 1 });
    createProduct(db, OWNER, { name: '香蕉', stock: 9 });

    const recommended = retrieveProducts(db, OWNER, '有什么推荐', { fallback: true });
    expect(recommended.map((r) => r.item.name)).toEqual(['香蕉', '苹果']);

    // Without the fallback flag, no lexical match -> empty.
    expect(retrieveProducts(db, OWNER, '有什么推荐')).toHaveLength(0);
    // With the flag but a non-recommendation query, still empty.
    expect(retrieveProducts(db, OWNER, '火星', { fallback: true })).toHaveLength(0);
  });

  it('never returns disabled products', () => {
    const db = setup();
    createProduct(db, OWNER, { name: '停售商品', enabled: false });
    expect(retrieveProducts(db, OWNER, '停售', { fallback: true })).toHaveLength(0);
  });
});

describe('retrieve wrapper', () => {
  it('combines knowledge and product hits with limits', () => {
    const db = setup();
    createKbEntry(db, OWNER, { title: '洗碗巾怎么洗', content: '可以机洗。' });
    createProduct(db, OWNER, { name: '竹纤维洗碗巾', stock: 3 });

    const result = retrieve(db, OWNER, '洗碗巾');
    expect(result.knowledge.length).toBeGreaterThan(0);
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('can skip products', () => {
    const db = setup();
    createProduct(db, OWNER, { name: '洗碗巾', stock: 3 });
    expect(retrieve(db, OWNER, '洗碗巾', { includeProducts: false }).products).toEqual([]);
  });
});

describe('wantsRecommendation', () => {
  it('detects recommendation phrasing in both languages', () => {
    expect(wantsRecommendation('有什么推荐')).toBe(true);
    expect(wantsRecommendation('recommend something')).toBe(true);
    expect(wantsRecommendation('你们卖什么')).toBe(true);
    expect(wantsRecommendation('退货怎么处理')).toBe(false);
  });
});
