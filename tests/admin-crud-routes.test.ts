import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listKb, POST as createKb } from '@/app/api/admin/knowledge/route';
import {
  DELETE as deleteKb,
  GET as getKb,
  PUT as updateKb,
} from '@/app/api/admin/knowledge/[id]/route';
import { GET as listProducts, POST as createProduct } from '@/app/api/admin/products/route';
import {
  DELETE as deleteProduct,
  PUT as updateProduct,
} from '@/app/api/admin/products/[id]/route';
import { POST as importProductsRoute } from '@/app/api/admin/products/import/route';
import { GET as downloadTemplate } from '@/app/api/admin/products/template/route';
import { resetDbCache } from '@/lib/db-runtime';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

let temp: TempDb | undefined;

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

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** GET with the admin session cookie attached. */
function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: adminSessionCookie() },
  });
}

function idParams(id: string | number) {
  return { params: { id: String(id) } };
}

describe('knowledge admin API', () => {
  it('creates, lists, updates and deletes entries', async () => {
    const created = await createKb(
      jsonRequest('/api/admin/knowledge', 'POST', {
        type: 'policy',
        title: '退换货政策',
        content: '7 天无理由退货',
        keywords: '退货 退款',
      }),
    );
    expect(created.status).toBe(201);
    const entry = (await created.json()).item;
    expect(entry).toMatchObject({ type: 'policy', title: '退换货政策', enabled: true });

    const list = await listKb(getRequest('/api/admin/knowledge'));
    expect((await list.json()).total).toBe(1);

    const updated = await updateKb(
      jsonRequest(`/api/admin/knowledge/${entry.id}`, 'PUT', { enabled: false, title: '新标题' }),
      idParams(entry.id),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).item).toMatchObject({ title: '新标题', enabled: false });

    const fetched = await getKb(getRequest('/'), idParams(entry.id));
    expect(fetched.status).toBe(200);

    const deleted = await deleteKb(getRequest('/'), idParams(entry.id));
    expect(deleted.status).toBe(200);
    expect((await deleteKb(getRequest('/'), idParams(entry.id))).status).toBe(404);
  });

  it('validates payloads', async () => {
    const missing = await createKb(
      jsonRequest('/api/admin/knowledge', 'POST', { title: 'x' }),
    );
    expect(missing.status).toBe(400);

    const badType = await createKb(
      jsonRequest('/api/admin/knowledge', 'POST', { title: 'x', content: 'y', type: 'nope' }),
    );
    expect(badType.status).toBe(400);

    const badJson = await createKb(jsonRequest('/api/admin/knowledge', 'POST', undefined));
    expect(badJson.status).toBe(400);

    const badId = await updateKb(getRequest('/'), idParams('abc'));
    expect(badId.status).toBe(400);
  });

  it('filters by search', async () => {
    await createKb(jsonRequest('/api/admin/knowledge', 'POST', { title: '物流说明', content: '包邮' }));
    await createKb(jsonRequest('/api/admin/knowledge', 'POST', { title: '支付说明', content: '微信' }));

    const res = await listKb(getRequest('/api/admin/knowledge?search=物流'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe('物流说明');
  });
});

describe('products admin API', () => {
  it('creates, updates and deletes products', async () => {
    const created = await createProduct(
      jsonRequest('/api/admin/products', 'POST', {
        name: '洗碗巾',
        sku: 'QH-001',
        price: 29.9,
        stock: 3,
        url: 'https://shop.example.com/p/1',
      }),
    );
    expect(created.status).toBe(201);
    const product = (await created.json()).item;
    expect(product.price).toBe(29.9);

    const updated = await updateProduct(
      jsonRequest(`/api/admin/products/${product.id}`, 'PUT', { price: 19.9, enabled: false }),
      idParams(product.id),
    );
    expect((await updated.json()).item).toMatchObject({ price: 19.9, enabled: false });

    const list = await listProducts(getRequest('/api/admin/products'));
    expect((await list.json()).total).toBe(1);

    expect((await deleteProduct(getRequest('/'), idParams(product.id))).status).toBe(200);
  });

  it('rejects duplicate SKUs and unsafe URLs', async () => {
    await createProduct(jsonRequest('/api/admin/products', 'POST', { name: 'A', sku: 'S1' }));
    const duplicate = await createProduct(
      jsonRequest('/api/admin/products', 'POST', { name: 'B', sku: 'S1' }),
    );
    expect(duplicate.status).toBe(409);

    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com/a']) {
      const res = await createProduct(
        jsonRequest('/api/admin/products', 'POST', { name: 'C', url }),
      );
      expect(res.status, url).toBe(400);
    }
  });

  it('validates numeric fields', async () => {
    const badPrice = await createProduct(
      jsonRequest('/api/admin/products', 'POST', { name: 'A', price: -1 }),
    );
    expect(badPrice.status).toBe(400);
    const badStock = await createProduct(
      jsonRequest('/api/admin/products', 'POST', { name: 'A', stock: 1.5 }),
    );
    expect(badStock.status).toBe(400);
    const missingName = await createProduct(
      jsonRequest('/api/admin/products', 'POST', { price: 1 }),
    );
    expect(missingName.status).toBe(400);
  });

  it('filters products by search', async () => {
    await createProduct(jsonRequest('/api/admin/products', 'POST', { name: '苹果', category: '水果' }));
    await createProduct(jsonRequest('/api/admin/products', 'POST', { name: '香蕉', category: '水果' }));
    const res = await listProducts(getRequest('/api/admin/products?search=苹果'));
    expect((await res.json()).total).toBe(1);
  });
});

describe('product import API', () => {
  function uploadRequest(filename: string, content: string): NextRequest {
    const form = new FormData();
    form.append('file', new File([content], filename, { type: 'text/csv' }));
    return new NextRequest('http://localhost/api/admin/products/import', {
      method: 'POST',
      headers: { cookie: adminSessionCookie() },
      body: form,
    });
  }

  it('imports a CSV upload', async () => {
    const res = await importProductsRoute(
      uploadRequest('p.csv', '名称,SKU,价格\n洗碗巾,QH-900,29.9\n'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, failed: 0 });
  });

  it('rejects unsupported formats and missing files', async () => {
    const badFormat = await importProductsRoute(uploadRequest('p.txt', 'hello'));
    expect(badFormat.status).toBe(415);
    expect((await badFormat.json()).error).toBe('unsupported_format');

    const form = new FormData();
    const noFile = await importProductsRoute(
      new NextRequest('http://localhost/api/admin/products/import', {
        method: 'POST',
        headers: { cookie: adminSessionCookie() },
        body: form,
      }),
    );
    expect(noFile.status).toBe(400);
  });

  it('rejects an oversized multipart body before parsing, even without Content-Length', async () => {
    // Build real multipart bytes, then send them as an unbounded stream so the
    // request carries no Content-Length header.
    const form = new FormData();
    form.append('file', new File(['x'.repeat(5 * 1024 * 1024 + 128 * 1024)], 'big.csv'));
    const raw = new Uint8Array(await new Response(form).arrayBuffer());
    const contentType = new Response(form).headers.get('content-type')!;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < raw.length; offset += 64 * 1024) {
          controller.enqueue(raw.slice(offset, offset + 64 * 1024));
        }
        controller.close();
      },
    });
    const request = new NextRequest('http://localhost/api/admin/products/import', {
      method: 'POST',
      headers: { 'content-type': contentType, cookie: adminSessionCookie() },
      body,
      ...({ duplex: 'half' } as { duplex?: 'half' }),
    });
    expect(request.headers.get('content-length')).toBeNull();

    const res = await importProductsRoute(request);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('file_too_large');
  });

  it('serves the CSV template', async () => {
    const res = await downloadTemplate(getRequest('/api/admin/products/template'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    expect(text).toContain('名称 / name');
  });
});
