import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDb,
  addCopyHistory,
  addMessage,
  createConversation,
  createKbEntry,
  createProduct,
  createSite,
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SITE_KEY,
  deleteConversation,
  deleteKbEntry,
  deleteProduct,
  deleteSite,
  ensureDefaultSite,
  getConversation,
  getKbEntry,
  getProduct,
  getProductBySku,
  getSiteByKey,
  getUserById,
  listConversations,
  listCopyHistory,
  listKbEntries,
  listMessages,
  listProducts,
  listSites,
  setConversationHandled,
  touchConversation,
  updateKbEntry,
  updateProduct,
  updateSite,
} from '@/lib/db';
import { seedSampleData } from '@/lib/seed';
import { createTempDb, type TempDb } from './helpers/tempdb';

/** Bootstrap admin that owns data in a fresh test database. */
const OWNER = 1;

let temp: TempDb | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function setup(options: Parameters<typeof createTempDb>[0] = {}) {
  temp = createTempDb(options);
  return temp;
}

describe('migrations & default site', () => {
  it('creates all tables and seeds the default site', () => {
    const { db } = setup();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const table of ['users', 'kb_entries', 'products', 'sites', 'conversations', 'messages', 'copy_history']) {
      expect(tables).toContain(table);
    }

    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(getUserById(db, 1)).toMatchObject({
      username: 'admin',
      role: 'admin',
      disabled: false,
      sessionVersion: 0,
    });
    const site = getSiteByKey(db, DEFAULT_SITE_KEY);
    expect(site).not.toBeNull();
    expect(site!.name).toBe('默认站点');
    expect(site!.allowedOrigins).toEqual(DEFAULT_ALLOWED_ORIGINS);
  });

  it('is idempotent when opening the same file twice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-idem-'));
    const dbPath = path.join(dir, 'same.db');
    try {
      const first = openDb({ dbPath });
      first.close();

      const second = openDb({ dbPath });
      expect(second.pragma('user_version', { simple: true })).toBe(2);
      expect(listSites(second, OWNER)).toHaveLength(1);
      ensureDefaultSite(second);
      expect(listSites(second, OWNER)).toHaveLength(1);
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can skip default site seeding', () => {
    const { db } = setup({ seedDefaultSite: false });
    expect(listSites(db, OWNER)).toHaveLength(0);
  });

  it("does not treat another user's site as the bootstrap admin's default", () => {
    const { db } = setup({ seedDefaultSite: false });
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
       VALUES (2, 'friend', '', 'user', 0, 0, ?)`,
    ).run(new Date().toISOString());
    const friendSite = createSite(db, 2, {
      name: '朋友的站点',
      siteKey: 'friend-site-key',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });

    const id = ensureDefaultSite(db);

    expect(id).not.toBe(friendSite.id);
    expect(listSites(db, OWNER).map((site) => site.siteKey)).toEqual([DEFAULT_SITE_KEY]);
    expect(listSites(db, 2).map((site) => site.siteKey)).toEqual(['friend-site-key']);
  });
});

describe('knowledge base repository', () => {
  it('creates, reads, updates and deletes entries', () => {
    const { db } = setup();
    const created = createKbEntry(db, OWNER, {
      type: 'policy',
      title: '退货政策',
      content: '7 天无理由退货',
      keywords: '退货',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.enabled).toBe(true);
    expect(created.type).toBe('policy');
    expect(getKbEntry(db, OWNER, created.id)).toMatchObject({ title: '退货政策' });

    const updated = updateKbEntry(db, OWNER, created.id, { title: '退换货政策', enabled: false });
    expect(updated!.title).toBe('退换货政策');
    expect(updated!.enabled).toBe(false);
    expect(updateKbEntry(db, OWNER, 9999, { title: 'x' })).toBeNull();

    expect(deleteKbEntry(db, OWNER, created.id)).toBe(true);
    expect(deleteKbEntry(db, OWNER, created.id)).toBe(false);
    expect(getKbEntry(db, OWNER, created.id)).toBeNull();
  });

  it('filters by search and enabled state', () => {
    const { db } = setup();
    createKbEntry(db, OWNER, { title: '物流说明', content: '包邮', keywords: '快递' });
    createKbEntry(db, OWNER, { title: '支付说明', content: '微信支付宝', enabled: false });

    expect(listKbEntries(db, OWNER)).toHaveLength(2);
    expect(listKbEntries(db, OWNER, { enabledOnly: true })).toHaveLength(1);
    expect(listKbEntries(db, OWNER, { search: '快递' }).map((e) => e.title)).toEqual(['物流说明']);
    expect(listKbEntries(db, OWNER, { search: '不存在的词' })).toHaveLength(0);
    expect(listKbEntries(db, OWNER, { limit: 1 })).toHaveLength(1);
  });
});

describe('products repository', () => {
  it('creates, reads, updates, deletes and enforces unique SKU', () => {
    const { db } = setup();
    const product = createProduct(db, OWNER, {
      sku: 'SKU-1',
      name: '洗碗巾',
      price: 29.9,
      stock: 5,
      sellingPoints: '吸水',
    });

    expect(getProduct(db, OWNER, product.id)!.name).toBe('洗碗巾');
    expect(getProductBySku(db, OWNER, 'SKU-1')!.id).toBe(product.id);

    const updated = updateProduct(db, OWNER, product.id, { price: 19.9, enabled: false });
    expect(updated!.price).toBe(19.9);
    expect(updated!.enabled).toBe(false);
    expect(updateProduct(db, OWNER, 9999, { name: 'x' })).toBeNull();

    expect(() => createProduct(db, OWNER, { sku: 'SKU-1', name: '重复' })).toThrow();
    expect(deleteProduct(db, OWNER, product.id)).toBe(true);
    expect(deleteProduct(db, OWNER, product.id)).toBe(false);
  });

  it('allows multiple products without SKU', () => {
    const { db } = setup();
    createProduct(db, OWNER, { name: 'A' });
    createProduct(db, OWNER, { name: 'B' });
    expect(listProducts(db, OWNER)).toHaveLength(2);
  });

  it('searches and filters products', () => {
    const { db } = setup();
    createProduct(db, OWNER, { name: '山茶花洗发水', category: '洗护', sku: 'A1' });
    createProduct(db, OWNER, { name: '收纳箱', category: '收纳', sku: 'B1', enabled: false });

    expect(listProducts(db, OWNER, { search: '洗发' })).toHaveLength(1);
    expect(listProducts(db, OWNER, { category: '收纳' })).toHaveLength(1);
    expect(listProducts(db, OWNER, { enabledOnly: true })).toHaveLength(1);
    expect(listProducts(db, OWNER, { limit: 1 })).toHaveLength(1);
  });
});

describe('sites repository', () => {
  it('creates, updates and deletes sites', () => {
    const { db } = setup();
    const site = createSite(db, OWNER, {
      name: '测试站',
      siteKey: 'test-key',
      allowedOrigins: ['https://shop.example.com'],
      rateLimitPerMin: 60,
    });

    expect(getSiteByKey(db, 'test-key')!.name).toBe('测试站');
    const updated = updateSite(db, OWNER, site.id, { allowedOrigins: ['https://a.com'], rateLimitPerMin: 10 });
    expect(updated!.allowedOrigins).toEqual(['https://a.com']);
    expect(updated!.rateLimitPerMin).toBe(10);
    expect(updateSite(db, OWNER, 9999, { name: 'x' })).toBeNull();

    expect(deleteSite(db, OWNER, site.id)).toBe(true);
  });

  it('refuses to delete a site that owns conversations', () => {
    const { db } = setup();
    const site = getSiteByKey(db, DEFAULT_SITE_KEY)!;
    createConversation(db, OWNER, { id: 'c1', siteId: site.id });
    expect(() => deleteSite(db, OWNER, site.id)).toThrow();
  });
});

describe('conversations & messages', () => {
  it('stores messages and computes summaries', () => {
    const { db } = setup();
    const site = getSiteByKey(db, DEFAULT_SITE_KEY)!;
    createConversation(db, OWNER, { id: 'conv-1', siteId: site.id, visitorId: 'v1', topIntent: 'price' });
    addMessage(db, OWNER, { id: 'm1', conversationId: 'conv-1', role: 'user', content: '多少钱', intent: 'price' });
    addMessage(db, OWNER, { id: 'm2', conversationId: 'conv-1', role: 'assistant', content: '29.9 元' });

    const messages = listMessages(db, OWNER, 'conv-1');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);

    touchConversation(db, OWNER, 'conv-1', { needsHuman: true, topIntent: 'after_sale' });
    const conversation = getConversation(db, OWNER, 'conv-1')!;
    expect(conversation.needsHuman).toBe(true);
    expect(conversation.topIntent).toBe('after_sale');

    const { items, total } = listConversations(db, OWNER);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ id: 'conv-1', siteName: '默认站点', messageCount: 2 });

    expect(listConversations(db, OWNER, { needsHuman: true }).total).toBe(1);
    expect(listConversations(db, OWNER, { handled: true }).total).toBe(0);

    expect(setConversationHandled(db, OWNER, 'conv-1', true)).toBe(true);
    expect(getConversation(db, OWNER, 'conv-1')!.handled).toBe(true);
    expect(setConversationHandled(db, OWNER, 'missing', true)).toBe(false);
  });

  it('cascades message deletion with the conversation', () => {
    const { db } = setup();
    const site = getSiteByKey(db, DEFAULT_SITE_KEY)!;
    createConversation(db, OWNER, { id: 'conv-2', siteId: site.id });
    addMessage(db, OWNER, { id: 'm3', conversationId: 'conv-2', role: 'user', content: 'hi' });

    expect(deleteConversation(db, OWNER, 'conv-2')).toBe(true);
    expect(listMessages(db, OWNER, 'conv-2')).toHaveLength(0);
  });
});

describe('copy history', () => {
  it('round-trips params and outputs', () => {
    const { db } = setup();
    const product = createProduct(db, OWNER, { name: '商品', price: 10 });
    addCopyHistory(db, OWNER, {
      id: 'ch1',
      productId: product.id,
      params: { platform: 'xhs', tone: 'lively' },
      outputs: { xhs: '文案 ✨' },
    });

    const [entry] = listCopyHistory(db, OWNER);
    expect(entry.params).toEqual({ platform: 'xhs', tone: 'lively' });
    expect(entry.outputs).toEqual({ xhs: '文案 ✨' });
    expect(listCopyHistory(db, OWNER, { productId: product.id })).toHaveLength(1);
    expect(listCopyHistory(db, OWNER, { productId: 9999 })).toHaveLength(0);
  });
});

describe('seedSampleData', () => {
  it('inserts sample data once and is idempotent', () => {
    const { db } = setup();

    const first = seedSampleData(db, OWNER);
    expect(first.kbInserted).toBeGreaterThan(0);
    expect(first.productsInserted).toBeGreaterThan(0);
    expect(listProducts(db, OWNER).some((p) => p.sku === 'QH-001')).toBe(true);

    const second = seedSampleData(db, OWNER);
    expect(second).toEqual({ kbInserted: 0, productsInserted: 0 });
  });
});
