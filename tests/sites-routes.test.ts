import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listSites, POST as createSiteRoute } from '@/app/api/admin/sites/route';
import {
  DELETE as deleteSiteRoute,
  GET as getSiteRoute,
  PUT as updateSiteRoute,
} from '@/app/api/admin/sites/[id]/route';
import {
  createConversation,
  createSite,
  getSiteByKey,
  DEFAULT_SITE_KEY,
  type DB,
} from '@/lib/db';
import { resetDbCache } from '@/lib/db-runtime';
import { resetWidgetRateLimits } from '@/lib/widget-ratelimit';
import {
  embedSnippet,
  generateSiteKey,
  isValidSiteKey,
  parseOrigins,
  requestBaseUrl,
} from '@/lib/sites';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
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

function params(id: string | number) {
  return { params: { id: String(id) } };
}

function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('site helpers', () => {
  it('generates valid shorthand site keys', () => {
    for (let index = 0; index < 20; index += 1) {
      const key = generateSiteKey();
      expect(isValidSiteKey(key), key).toBe(true);
      expect(key).toMatch(/^[a-zA-Z0-9]{14}$/);
    }
    // Random, not a counter.
    expect(new Set(Array.from({ length: 10 }, generateSiteKey)).size).toBe(10);
  });

  it('validates site keys', () => {
    expect(isValidSiteKey('abc123')).toBe(true);
    expect(isValidSiteKey('abc')).toBe(false);
    expect(isValidSiteKey('has space')).toBe(false);
    expect(isValidSiteKey('x'.repeat(65))).toBe(false);
    expect(isValidSiteKey('emoji-✅')).toBe(false);
  });

  it('normalizes origin lists and rejects unsafe entries', () => {
    expect(parseOrigins('https://Shop.Example.com/\nhttp://localhost:3000')).toEqual([
      'https://shop.example.com',
      'http://localhost:3000',
    ]);
    expect(parseOrigins(['https://a.example.com', 'https://a.example.com'])).toEqual([
      'https://a.example.com',
    ]);
    expect(parseOrigins('')).toEqual([]);

    for (const bad of [
      '*',
      'shop.example.com',
      'ftp://shop.example.com',
      'https://shop.example.com/path',
      'javascript:alert(1)',
      ['https://a.example.com', 5],
      null,
    ]) {
      expect(parseOrigins(bad as unknown), JSON.stringify(bad)).toBeNull();
    }
  });

  it('builds embed snippets and infers the base URL', () => {
    expect(embedSnippet('abc123')).toBe(
      '<script src="https://YOUR-DOMAIN/widget.js" data-site-key="abc123" async></script>',
    );
    expect(embedSnippet('abc123', 'https://shop-ai.example.com/')).toBe(
      '<script src="https://shop-ai.example.com/widget.js" data-site-key="abc123" async></script>',
    );

    const request = new NextRequest('http://internal:3000/api/admin/sites', {
      headers: { host: 'shop-ai.example.com', 'x-forwarded-proto': 'https' },
    });
    expect(requestBaseUrl(request)).toBe('https://shop-ai.example.com');
  });
});

describe('GET/POST /api/admin/sites', () => {
  it('lists sites with embed snippets', async () => {
    const response = listSites(new NextRequest('http://localhost/api/admin/sites'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      name: '默认站点',
      siteKey: DEFAULT_SITE_KEY,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      rateLimitPerMin: 30,
    });
    expect(body.items[0].embedSnippet).toContain(`data-site-key="${DEFAULT_SITE_KEY}"`);
    expect(body.items[0].embedSnippet).toContain('http://localhost/widget.js');
  });

  it('creates a site with an auto-generated key', async () => {
    const response = await createSiteRoute(
      jsonRequest('/api/admin/sites', 'POST', {
        name: '品牌官网',
        allowedOrigins: 'https://shop.example.com\nhttps://www.shop.example.com',
        rateLimitPerMin: 60,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.item.name).toBe('品牌官网');
    expect(isValidSiteKey(body.item.siteKey)).toBe(true);
    expect(body.item.allowedOrigins).toEqual([
      'https://shop.example.com',
      'https://www.shop.example.com',
    ]);
    expect(body.item.rateLimitPerMin).toBe(60);
    expect(getSiteByKey(db(), body.item.siteKey)).not.toBeNull();
  });

  it('accepts a custom key and rejects duplicates', async () => {
    const custom = await createSiteRoute(
      jsonRequest('/api/admin/sites', 'POST', { name: 'A', siteKey: 'my-site-key-1' }),
    );
    expect(custom.status).toBe(201);

    const duplicate = await createSiteRoute(
      jsonRequest('/api/admin/sites', 'POST', { name: 'B', siteKey: 'my-site-key-1' }),
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toBe('duplicate_site_key');
  });

  it('validates the payload', async () => {
    const cases: [unknown, string][] = [
      [{}, 'invalid_name'],
      [{ name: 'x', allowedOrigins: '*' }, 'invalid_origins'],
      [{ name: 'x', allowedOrigins: ['ftp://a.com'] }, 'invalid_origins'],
      [{ name: 'x', rateLimitPerMin: 0 }, 'invalid_rate_limit'],
      [{ name: 'x', rateLimitPerMin: 601 }, 'invalid_rate_limit'],
      [{ name: 'x', rateLimitPerMin: 1.5 }, 'invalid_rate_limit'],
      [{ name: 'x', siteKey: 'bad key!' }, 'invalid_site_key'],
    ];
    for (const [body, error] of cases) {
      const response = await createSiteRoute(jsonRequest('/api/admin/sites', 'POST', body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toBe(error);
    }

    const badJson = await createSiteRoute(
      new NextRequest('http://localhost/api/admin/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(badJson.status).toBe(400);
  });

  it('caps the number of sites', async () => {
    for (let index = 0; index < 19; index += 1) {
      createSite(db(), {
        name: `s${index}`,
        siteKey: `site-key-${index}`,
        allowedOrigins: [],
        rateLimitPerMin: 30,
      });
    }
    const response = await createSiteRoute(
      jsonRequest('/api/admin/sites', 'POST', { name: 'one too many' }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('too_many_sites');
  });
});

describe('/api/admin/sites/[id]', () => {
  it('returns a single site', async () => {
    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    const response = getSiteRoute(new NextRequest('http://localhost'), params(site.id));
    expect(response.status).toBe(200);
    expect((await response.json()).item.siteKey).toBe(DEFAULT_SITE_KEY);

    expect(getSiteRoute(new NextRequest('http://localhost'), params(9999)).status).toBe(404);
    expect(getSiteRoute(new NextRequest('http://localhost'), params('abc')).status).toBe(400);
  });

  it('updates name, origins, rate limit and key', async () => {
    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    const response = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', {
        name: '新名称',
        allowedOrigins: ['https://shop.example.com'],
        rateLimitPerMin: 10,
        siteKey: 'new-key-123',
      }),
      params(site.id),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item).toMatchObject({
      name: '新名称',
      siteKey: 'new-key-123',
      allowedOrigins: ['https://shop.example.com'],
      rateLimitPerMin: 10,
    });
    expect(body.item.embedSnippet).toContain('new-key-123');
  });

  it('validates updates', async () => {
    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;

    const empty = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', {}),
      params(site.id),
    );
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe('no_updates');

    const badOrigins = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', { allowedOrigins: ['*'] }),
      params(site.id),
    );
    expect(badOrigins.status).toBe(400);

    const badRate = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', { rateLimitPerMin: -5 }),
      params(site.id),
    );
    expect(badRate.status).toBe(400);

    const badKey = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', { siteKey: 'x' }),
      params(site.id),
    );
    expect(badKey.status).toBe(400);

    const missing = await updateSiteRoute(
      jsonRequest('/api/admin/sites/9999', 'PUT', { name: 'x' }),
      params(9999),
    );
    expect(missing.status).toBe(404);
  });

  it('rejects duplicate keys on update', async () => {
    createSite(db(), {
      name: 'other',
      siteKey: 'taken-key-99',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });
    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    const response = await updateSiteRoute(
      jsonRequest(`/api/admin/sites/${site.id}`, 'PUT', { siteKey: 'taken-key-99' }),
      params(site.id),
    );
    expect(response.status).toBe(409);
  });

  it('deletes sites without conversations and refuses ones with history', async () => {
    const empty = createSite(db(), {
      name: '空站点',
      siteKey: 'empty-site-key',
      allowedOrigins: [],
      rateLimitPerMin: 30,
    });
    expect(deleteSiteRoute(new NextRequest('http://localhost'), params(empty.id)).status).toBe(200);

    const site = getSiteByKey(db(), DEFAULT_SITE_KEY)!;
    createConversation(db(), { id: 'conv-1', siteId: site.id });
    const blocked = deleteSiteRoute(new NextRequest('http://localhost'), params(site.id));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe('site_has_conversations');
  });
});
