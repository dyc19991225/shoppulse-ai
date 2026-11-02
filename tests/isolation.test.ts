import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listKb, POST as createKb } from '@/app/api/admin/knowledge/route';
import {
  DELETE as deleteKb,
  GET as getKb,
  PUT as updateKb,
} from '@/app/api/admin/knowledge/[id]/route';
import { GET as listProductsRoute, POST as createProductRoute } from '@/app/api/admin/products/route';
import {
  DELETE as deleteProductRoute,
  GET as getProductRoute,
  PUT as updateProductRoute,
} from '@/app/api/admin/products/[id]/route';
import { POST as importProductsRoute } from '@/app/api/admin/products/import/route';
import { GET as listSitesRoute, POST as createSiteRoute } from '@/app/api/admin/sites/route';
import {
  DELETE as deleteSiteRoute,
  GET as getSiteRoute,
  PUT as updateSiteRoute,
} from '@/app/api/admin/sites/[id]/route';
import { GET as listConversationsRoute } from '@/app/api/admin/conversations/route';
import {
  GET as getConversationRoute,
  PUT as markConversationRoute,
} from '@/app/api/admin/conversations/[id]/route';
import { GET as statsRoute } from '@/app/api/admin/stats/route';
import { GET as copyHistoryRoute, POST as copywriteRoute } from '@/app/api/admin/copywrite/route';
import { POST as widgetChatRoute } from '@/app/api/widget/chat/route';
import { GET as widgetConfigRoute } from '@/app/api/widget/config/route';
import {
  addMessage,
  createConversation,
  createKbEntry,
  createProduct,
  createSite,
  DEFAULT_SITE_KEY,
  getCopyHistory,
  getSiteByKey,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { resetProviderCache } from '@/lib/llm';
import { resetWidgetRateLimits } from '@/lib/widget-ratelimit';
import { runChat, type ChatEvent } from '@/lib/chat';
import type { ChatRequest, CompletionRequest, LlmProvider } from '@/lib/llm/types';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

/**
 * End-to-end isolation (M2): two users hit the real route handlers and must
 * never list, read, update, delete or import over each other's data. Guessing
 * another owner's id returns 404, never 403, and the widget only ever uses the
 * KB/products of the site owner.
 */

interface TestUser {
  id: number;
  username: string;
}

const USER_A: TestUser = { id: 1, username: 'admin' };
const USER_B: TestUser = { id: 2, username: 'beta' };

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('SHOPPULSE_LLM_API_KEY', '');
  resetDbCache();
  resetProviderCache();
  resetWidgetRateLimits();

  // User 1 is created by migration v2; add the second account here.
  temp.db
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
       VALUES (?, ?, '', 'user', 0, 0, ?)`,
    )
    .run(USER_B.id, USER_B.username, new Date().toISOString());
});

afterEach(() => {
  resetDbCache();
  resetProviderCache();
  resetWidgetRateLimits();
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
  user: TestUser,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = {
    cookie: adminSessionCookie(user),
    ...init.headers,
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost${url}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function uploadAs(user: TestUser, filename: string, content: string): NextRequest {
  const form = new FormData();
  form.append('file', new File([content], filename, { type: 'text/csv' }));
  return new NextRequest('http://localhost/api/admin/products/import', {
    method: 'POST',
    headers: { cookie: adminSessionCookie(user) },
    body: form,
  });
}

function widgetChat(body: unknown, origin?: string): NextRequest {
  return new NextRequest('http://localhost/api/widget/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.21',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readSse(response: Response): Promise<{ event: string; data: any }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.+)$/m.exec(block)?.[1] ?? '',
      data: JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null'),
    }));
}

describe('knowledge base isolation', () => {
  it('lists, reads, updates and deletes only the owner entries', async () => {
    const created = await createKb(
      as(USER_A, '/api/admin/knowledge', {
        method: 'POST',
        body: { type: 'policy', title: 'A policy', content: 'A only' },
      }),
    );
    expect(created.status).toBe(201);
    const aEntry = (await created.json()).item;

    const bList = await listKb(as(USER_B, '/api/admin/knowledge'));
    expect((await bList.json()).total).toBe(0);

    expect((await getKb(as(USER_B, '/'), params(aEntry.id))).status).toBe(404);
    expect(
      (
        await updateKb(
          as(USER_B, '/', { method: 'PUT', body: { title: 'hijacked' } }),
          params(aEntry.id),
        )
      ).status,
    ).toBe(404);
    expect((await deleteKb(as(USER_B, '/'), params(aEntry.id))).status).toBe(404);

    // The owner still sees the untouched row.
    const aGet = await getKb(as(USER_A, '/'), params(aEntry.id));
    expect(aGet.status).toBe(200);
    expect((await aGet.json()).item.title).toBe('A policy');

    const bCreated = await createKb(
      as(USER_B, '/api/admin/knowledge', {
        method: 'POST',
        body: { title: 'B policy', content: 'B only' },
      }),
    );
    expect(bCreated.status).toBe(201);

    const aList = await listKb(as(USER_A, '/api/admin/knowledge'));
    const aTitles = (await aList.json()).items.map((item: { title: string }) => item.title);
    expect(aTitles).toEqual(['A policy']);

    const bAfter = await listKb(as(USER_B, '/api/admin/knowledge'));
    const bTitles = (await bAfter.json()).items.map((item: { title: string }) => item.title);
    expect(bTitles).toEqual(['B policy']);
  });
});

describe('product isolation', () => {
  it('scopes products and allows the same SKU for different owners', async () => {
    const aCreated = await createProductRoute(
      as(USER_A, '/api/admin/products', {
        method: 'POST',
        body: { sku: 'SHARED-1', name: 'A towel', price: 29.9 },
      }),
    );
    expect(aCreated.status).toBe(201);
    const aProduct = (await aCreated.json()).item;

    // The same SKU is only unique per owner.
    const bCreated = await createProductRoute(
      as(USER_B, '/api/admin/products', {
        method: 'POST',
        body: { sku: 'SHARED-1', name: 'B towel', price: 19.9 },
      }),
    );
    expect(bCreated.status).toBe(201);
    const bProduct = (await bCreated.json()).item;
    expect(bProduct.id).not.toBe(aProduct.id);

    const duplicate = await createProductRoute(
      as(USER_A, '/api/admin/products', {
        method: 'POST',
        body: { sku: 'SHARED-1', name: 'A duplicate' },
      }),
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toBe('duplicate_sku');

    const aList = await listProductsRoute(as(USER_A, '/api/admin/products'));
    const aItems = (await aList.json()).items;
    expect(aItems).toHaveLength(1);
    expect(aItems[0]).toMatchObject({ id: aProduct.id, name: 'A towel' });

    const bList = await listProductsRoute(as(USER_B, '/api/admin/products'));
    const bItems = (await bList.json()).items;
    expect(bItems).toHaveLength(1);
    expect(bItems[0]).toMatchObject({ id: bProduct.id, name: 'B towel' });

    // Cross-owner ids are indistinguishable from missing rows.
    expect((await getProductRoute(as(USER_B, '/'), params(aProduct.id))).status).toBe(404);
    expect(
      (
        await updateProductRoute(
          as(USER_B, '/', { method: 'PUT', body: { price: 1 } }),
          params(aProduct.id),
        )
      ).status,
    ).toBe(404);
    expect((await deleteProductRoute(as(USER_B, '/'), params(aProduct.id))).status).toBe(404);

    const after = await getProductRoute(as(USER_A, '/'), params(aProduct.id));
    expect((await after.json()).item).toMatchObject({ name: 'A towel', price: 29.9 });
  });

  it('upserts CSV imports by SKU only inside the importer owner', async () => {
    const aImport = await importProductsRoute(
      uploadAs(USER_A, 'products.csv', 'name,sku,price\nA original,IMP-1,10\n'),
    );
    expect(aImport.status).toBe(200);
    expect(await aImport.json()).toMatchObject({ created: 1, updated: 0 });

    // B importing the same SKU must create B's own row, not overwrite A's.
    const bImport = await importProductsRoute(
      uploadAs(USER_B, 'products.csv', 'name,sku,price\nB own,IMP-1,20\n'),
    );
    expect(bImport.status).toBe(200);
    expect(await bImport.json()).toMatchObject({ created: 1, updated: 0 });

    const aProducts = [
      ...(db()
        .prepare('SELECT * FROM products WHERE owner_id = ? AND sku = ?')
        .all(USER_A.id, 'IMP-1') as { name: string; price: number }[]),
    ];
    const bProducts = [
      ...(db()
        .prepare('SELECT * FROM products WHERE owner_id = ? AND sku = ?')
        .all(USER_B.id, 'IMP-1') as { name: string; price: number }[]),
    ];
    expect(aProducts).toHaveLength(1);
    expect(aProducts[0]).toMatchObject({ name: 'A original', price: 10 });
    expect(bProducts).toHaveLength(1);
    expect(bProducts[0]).toMatchObject({ name: 'B own', price: 20 });

    // Re-importing updates only the importer's row.
    const aUpdate = await importProductsRoute(
      uploadAs(USER_A, 'products.csv', 'name,sku,price\nA updated,IMP-1,11\n'),
    );
    expect(await aUpdate.json()).toMatchObject({ created: 0, updated: 1 });
    const aAfter = db()
      .prepare('SELECT name, price FROM products WHERE owner_id = ? AND sku = ?')
      .get(USER_A.id, 'IMP-1') as { name: string; price: number };
    const bAfter = db()
      .prepare('SELECT name, price FROM products WHERE owner_id = ? AND sku = ?')
      .get(USER_B.id, 'IMP-1') as { name: string; price: number };
    expect(aAfter).toMatchObject({ name: 'A updated', price: 11 });
    expect(bAfter).toMatchObject({ name: 'B own', price: 20 });
  });
});

describe('site isolation', () => {
  it('scopes sites while keeping site keys globally unique', async () => {
    const defaultSite = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    expect(defaultSite.ownerId).toBe(USER_A.id);

    const bBefore = await listSitesRoute(as(USER_B, '/api/admin/sites'));
    expect((await bBefore.json()).total).toBe(0);

    const bCreated = await createSiteRoute(
      as(USER_B, '/api/admin/sites', {
        method: 'POST',
        body: {
          name: 'B site',
          allowedOrigins: ['https://b.example.com'],
        },
      }),
    );
    expect(bCreated.status).toBe(201);
    const bSite = (await bCreated.json()).item;
    expect(bSite.ownerId).toBe(USER_B.id);

    const aList = await listSitesRoute(as(USER_A, '/api/admin/sites'));
    const aItems = (await aList.json()).items;
    expect(aItems.map((item: { id: number }) => item.id)).toEqual([defaultSite.id]);

    const bList = await listSitesRoute(as(USER_B, '/api/admin/sites'));
    const bItems = (await bList.json()).items;
    expect(bItems.map((item: { id: number }) => item.id)).toEqual([bSite.id]);

    // Cross-owner site ids return 404 for read, update and delete.
    expect((await getSiteRoute(as(USER_B, '/'), params(defaultSite.id))).status).toBe(404);
    expect(
      (
        await updateSiteRoute(
          as(USER_B, '/', { method: 'PUT', body: { name: 'hijacked' } }),
          params(defaultSite.id),
        )
      ).status,
    ).toBe(404);
    expect((await deleteSiteRoute(as(USER_B, '/'), params(defaultSite.id))).status).toBe(404);

    // Site keys remain a global namespace (the public widget id).
    const duplicateKey = await createSiteRoute(
      as(USER_B, '/api/admin/sites', {
        method: 'POST',
        body: { name: 'duplicate', siteKey: DEFAULT_SITE_KEY },
      }),
    );
    expect(duplicateKey.status).toBe(409);
    expect((await duplicateKey.json()).error).toBe('duplicate_site_key');

    // B's own site remains readable and deletable.
    expect((await getSiteRoute(as(USER_B, '/'), params(bSite.id))).status).toBe(200);
    expect((await deleteSiteRoute(as(USER_B, '/'), params(bSite.id))).status).toBe(200);
  });
});

describe('conversation isolation', () => {
  it('scopes list, detail and mark-handled through sites.owner_id', async () => {
    const bSite = createSite(db(), USER_B.id, {
      name: 'B site',
      siteKey: 'b-site-key',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });
    createConversation(db(), USER_B.id, {
      id: 'b-conv',
      siteId: bSite.id,
      visitorId: 'v-b',
      topIntent: 'price',
    });
    addMessage(db(), USER_B.id, {
      id: 'b-msg',
      conversationId: 'b-conv',
      role: 'user',
      content: 'B only question',
    });

    const aList = await listConversationsRoute(as(USER_A, '/api/admin/conversations'));
    expect((await aList.json()).total).toBe(0);

    const bList = await listConversationsRoute(as(USER_B, '/api/admin/conversations'));
    const bBody = await bList.json();
    expect(bBody.total).toBe(1);
    expect(bBody.items[0]).toMatchObject({ id: 'b-conv', siteName: 'B site', messageCount: 1 });

    // A (even as admin) cannot read or mutate B's conversation.
    expect((await getConversationRoute(as(USER_A, '/'), params('b-conv'))).status).toBe(404);
    const aMark = await markConversationRoute(
      as(USER_A, '/', { method: 'PUT', body: { handled: true } }),
      params('b-conv'),
    );
    expect(aMark.status).toBe(404);
    expect(
      (db().prepare('SELECT handled FROM conversations WHERE id = ?').get('b-conv') as {
        handled: number;
      }).handled,
    ).toBe(0);

    const bDetail = await getConversationRoute(as(USER_B, '/'), params('b-conv'));
    expect(bDetail.status).toBe(200);
    expect((await bDetail.json()).messages).toHaveLength(1);

    const bMark = await markConversationRoute(
      as(USER_B, '/', { method: 'PUT', body: { handled: true } }),
      params('b-conv'),
    );
    expect(bMark.status).toBe(200);
    expect(
      (db().prepare('SELECT handled FROM conversations WHERE id = ?').get('b-conv') as {
        handled: number;
      }).handled,
    ).toBe(1);
  });
});

describe('stats isolation', () => {
  it("counts only the owner's rows, conversations and question terms", async () => {
    const aSite = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    const bSite = createSite(db(), USER_B.id, {
      name: 'B site',
      siteKey: 'b-stats-site',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });

    createKbEntry(db(), USER_A.id, { title: 'alpha policy', content: 'alpha only content' });
    createProduct(db(), USER_A.id, { name: 'alpha product', price: 10 });
    createConversation(db(), USER_A.id, { id: 'a-conv', siteId: aSite.id, topIntent: 'price' });
    addMessage(db(), USER_A.id, {
      id: 'a-msg',
      conversationId: 'a-conv',
      role: 'user',
      content: 'alpha shipping question',
      intent: 'logistics',
    });

    createKbEntry(db(), USER_B.id, { title: 'bravo policy', content: 'bravo only content' });
    createProduct(db(), USER_B.id, { name: 'bravo product', price: 20 });
    createConversation(db(), USER_B.id, { id: 'b-conv', siteId: bSite.id, topIntent: 'price' });
    addMessage(db(), USER_B.id, {
      id: 'b-msg',
      conversationId: 'b-conv',
      role: 'user',
      content: 'bravo shipping question',
      intent: 'logistics',
    });

    const aStats = await statsRoute(as(USER_A, '/api/admin/stats'));
    expect(aStats.status).toBe(200);
    const aBody = await aStats.json();
    expect(aBody.totals).toEqual({
      conversations: 1,
      kbEntries: 1,
      products: 1,
      copyHistory: 0,
      sites: 1,
    });
    expect(aBody.last7Days.conversations).toBe(1);
    const aTerms = aBody.topQuestions.map((item: { term: string }) => item.term);
    expect(aTerms).toContain('alpha');
    expect(aTerms).not.toContain('bravo');

    const bStats = await statsRoute(as(USER_B, '/api/admin/stats'));
    const bBody = await bStats.json();
    expect(bBody.totals).toEqual({
      conversations: 1,
      kbEntries: 1,
      products: 1,
      copyHistory: 0,
      sites: 1,
    });
    const bTerms = bBody.topQuestions.map((item: { term: string }) => item.term);
    expect(bTerms).toContain('bravo');
    expect(bTerms).not.toContain('alpha');
  });
});

describe('copywriting isolation', () => {
  it("scopes product lookup and history to the logged-in owner", async () => {
    const aProduct = createProduct(db(), USER_A.id, {
      name: 'A product',
      sku: 'COPY-A',
      price: 10,
    });
    const bProduct = createProduct(db(), USER_B.id, {
      name: 'B product',
      sku: 'COPY-B',
      price: 20,
    });

    // B cannot generate copy for A's product id.
    const crossOwner = await copywriteRoute(
      as(USER_B, '/api/admin/copywrite', {
        method: 'POST',
        body: { productId: aProduct.id, platforms: ['moments'] },
      }),
    );
    expect(crossOwner.status).toBe(404);
    expect((await crossOwner.json()).error).toBe('product_not_found');

    const bCopy = await copywriteRoute(
      as(USER_B, '/api/admin/copywrite', {
        method: 'POST',
        body: { productId: bProduct.id, platforms: ['moments'] },
      }),
    );
    expect(bCopy.status).toBe(201);
    const historyId = (await bCopy.json()).historyId;

    const aHistory = await copyHistoryRoute(as(USER_A, '/api/admin/copywrite'));
    expect((await aHistory.json()).total).toBe(0);

    const bHistory = await copyHistoryRoute(as(USER_B, '/api/admin/copywrite'));
    const bBody = await bHistory.json();
    expect(bBody.total).toBe(1);
    expect(bBody.items[0].id).toBe(historyId);

    expect(getCopyHistory(db(), USER_A.id, historyId)).toBeNull();
    expect(getCopyHistory(db(), USER_B.id, historyId)).not.toBeNull();
  });
});

/** Streams a fixed answer, so the price guard can be exercised deterministically. */
class RecordingProvider implements LlmProvider {
  readonly kind = 'openai' as const;
  model = 'test-model';
  lastMessages: ChatRequest['messages'] = [];
  constructor(private readonly answer: string) {}

  async *stream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    this.lastMessages = request.messages;
    for (const chunk of this.answer.match(/.{1,5}/gs) ?? []) yield chunk;
  }

  async complete(_request: CompletionRequest): Promise<string> {
    return this.answer;
  }
}

async function collectChat(
  db: DB,
  site: ReturnType<typeof getSiteByKey>,
  message: string,
  provider: LlmProvider,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of runChat({ db, site: site!, provider, message })) {
    events.push(event);
  }
  return events;
}

describe('widget site-owner isolation', () => {
  it("uses only B's KB and products for B's site key", async () => {
    createKbEntry(db(), USER_A.id, {
      title: 'A-only product policy',
      content: 'A_SECRET_CONTENT return window is 99 days',
      keywords: 'A-only product policy',
    });
    createProduct(db(), USER_A.id, {
      name: 'A-only product',
      sku: 'A-ONLY',
      price: 100,
      stock: 1,
      sellingPoints: 'A_SECRET_SELLING_POINT',
    });

    createKbEntry(db(), USER_B.id, {
      title: 'B-only product policy',
      content: 'B_ONLY_CONTENT return window is 7 days',
      keywords: 'B-only product policy',
    });
    createProduct(db(), USER_B.id, {
      name: 'B-only product',
      sku: 'B-ONLY',
      price: 29.9,
      stock: 5,
      sellingPoints: 'B_ONLY_SELLING_POINT',
    });

    const bSite = createSite(db(), USER_B.id, {
      name: 'B widget site',
      siteKey: 'b-widget-site',
      allowedOrigins: ['https://b.example.com'],
      rateLimitPerMin: 30,
    });

    const response = await widgetChatRoute(
      widgetChat(
        { siteKey: bSite.siteKey, message: 'B-only product policy' },
        'https://b.example.com',
      ),
    );
    expect(response.status).toBe(200);

    const events = await readSse(response);
    const products = events.find((event) => event.event === 'products')?.data.items ?? [];
    expect(products.map((item: { name: string }) => item.name)).toEqual(['B-only product']);
    expect(JSON.stringify(products)).not.toContain('A-only product');

    // The model prompt only contained B's resources, so neither A's KB text
    // nor A's selling points can reach the answer.
    const answer = events
      .filter((event) => event.event === 'delta')
      .map((event) => event.data.text)
      .join('');
    expect(answer).toContain('B_ONLY_CONTENT');
    expect(answer).not.toContain('A_SECRET');
    expect(answer).not.toContain('A-only');
  });

  it("price guard allows only the site owner's product prices", async () => {
    createProduct(db(), USER_A.id, { name: 'A-only product', sku: 'A-ONLY', price: 100 });
    createProduct(db(), USER_B.id, {
      name: 'B-only product',
      sku: 'B-ONLY',
      price: 29.9,
      stock: 5,
    });
    const bSite = createSite(db(), USER_B.id, {
      name: 'B widget site',
      siteKey: 'b-price-site',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });

    const provider = new RecordingProvider('B-only product ¥29.9，A-only product ¥100。');
    const events = await collectChat(
      db(),
      getSiteByKey(db(), bSite.siteKey),
      'B-only product 多少钱',
      provider,
    );

    const answer = events
      .filter((event): event is Extract<ChatEvent, { event: 'delta' }> => event.event === 'delta')
      .map((event) => event.data.text)
      .join('');
    expect(answer).toContain('¥29.9');
    expect(answer).not.toContain('¥100');
    expect(answer).toContain('金额未核实');
    expect(JSON.stringify(provider.lastMessages)).toContain('B-only product');
    expect(JSON.stringify(provider.lastMessages)).not.toContain('A-only product');
  });

  it("serves B's config without exposing its owner id", async () => {
    const bSite = createSite(db(), USER_B.id, {
      name: 'B widget site',
      siteKey: 'b-config-site',
      allowedOrigins: ['https://b.example.com'],
      rateLimitPerMin: 12,
    });

    const response = widgetConfigRoute(
      new NextRequest('http://localhost/api/widget/config?site_key=b-config-site', {
        headers: { origin: 'https://b.example.com' },
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      siteKey: bSite.siteKey,
      siteName: 'B widget site',
      rateLimitPerMin: 12,
    });
    expect(payload).not.toHaveProperty('ownerId');
    expect(payload).not.toHaveProperty('allowedOrigins');
  });
});
