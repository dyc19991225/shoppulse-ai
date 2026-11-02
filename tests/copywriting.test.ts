import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMockCopy,
  buildPlatformPrompt,
  COPY_PLATFORMS,
  ensureEmoji,
  finalizePlatformCopy,
  generateCopywriting,
  hasEmoji,
  isCopyPlatform,
  isCopyTone,
  parsePlatformOutput,
  splitSellingPoints,
} from '@/lib/copywriting';
import { createProduct, getProduct, listCopyHistory, type DB } from '@/lib/db';
import { MockProvider } from '@/lib/llm/mock';
import type { ChatRequest, CompletionRequest, LlmProvider } from '@/lib/llm/types';
import { resetDbCache } from '@/lib/db-runtime';
import { resetProviderCache } from '@/lib/llm';
import { GET as historyGet, POST as copywritePost } from '@/app/api/admin/copywrite/route';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SHOPPULSE_LLM_API_KEY', '');
  resetDbCache();
  resetProviderCache();
});

afterEach(() => {
  resetDbCache();
  resetProviderCache();
  vi.unstubAllEnvs();
  temp?.cleanup();
  temp = undefined;
});

function db(): DB {
  return temp!.db;
}

function sampleProduct(name = '青禾竹纤维洗碗巾') {
  return createProduct(db(), {
    name,
    sku: 'QH-001',
    category: '厨房清洁',
    price: 29.9,
    stock: 100,
    description: '天然竹纤维材质，吸水快、不易掉毛。',
    sellingPoints: '吸油不挂油；可机洗；3 条装',
    url: 'https://shop.example.com/p/1',
  });
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Provider that records every prompt and returns one JSON result per call. */
class RecordingJsonProvider implements LlmProvider {
  readonly kind = 'openai' as const;
  model = 'test-model';
  calls: CompletionRequest[] = [];
  constructor(private readonly respond: (call: number) => string) {}

  async *stream(_request: ChatRequest): AsyncGenerator<string, void, unknown> {
    yield '';
  }

  async complete(request: CompletionRequest): Promise<string> {
    this.calls.push(request);
    return this.respond(this.calls.length);
  }
}

describe('copywriting helpers', () => {
  it('validates platforms and tones', () => {
    for (const platform of COPY_PLATFORMS) expect(isCopyPlatform(platform)).toBe(true);
    expect(isCopyPlatform('weibo')).toBe(false);
    expect(isCopyTone('lively')).toBe(true);
    expect(isCopyTone('angry')).toBe(false);
  });

  it('splits stored selling points on Chinese/English separators', () => {
    expect(splitSellingPoints('吸水；可机洗;3 条装\n耐用')).toEqual(['吸水', '可机洗', '3 条装', '耐用']);
    expect(splitSellingPoints('')).toEqual([]);
  });

  it('detects and adds emoji', () => {
    expect(hasEmoji('好物 ✨')).toBe(true);
    expect(hasEmoji('plain text')).toBe(false);
    const decorated = ensureEmoji('好物', 'xiaohongshu');
    expect(hasEmoji(decorated)).toBe(true);
    expect(decorated.startsWith('好物')).toBe(true);
    expect(ensureEmoji('', 'moments')).toBe('');
  });

  it('parses JSON, fenced JSON and plain text model output', () => {
    expect(parsePlatformOutput('{"title":"T","body":"B"}')).toEqual({ title: 'T', body: 'B' });
    expect(parsePlatformOutput('```json\n{"headline":"H","content":"C"}\n```')).toEqual({
      title: 'H',
      body: 'C',
    });
    expect(parsePlatformOutput('标题行\n正文第一行\n正文第二行')).toEqual({
      title: '标题行',
      body: '正文第一行\n正文第二行',
    });
    expect(parsePlatformOutput('只有一行正文')).toEqual({ title: '', body: '只有一行正文' });
    expect(parsePlatformOutput('   ')).toEqual({ title: '', body: '' });
  });

  it('builds platform-specific prompts with the real price and language rule', () => {
    const product = sampleProduct();
    const zh = buildPlatformPrompt({
      platform: 'douyin',
      product,
      audience: '年轻妈妈',
      sellingPoints: ['可机洗'],
      tone: 'lively',
      lang: 'zh',
    });
    expect(zh.system).toContain('抖音');
    expect(zh.system).toContain('JSON');
    expect(zh.user).toContain('¥29.90');
    expect(zh.user).toContain('年轻妈妈');
    expect(zh.user).toContain('可机洗');

    const en = buildPlatformPrompt({
      platform: 'detail',
      product,
      audience: '',
      sellingPoints: [],
      tone: 'premium',
      lang: 'en',
    });
    expect(en.system).toContain('Write the copy in English');
    expect(en.system).toContain('E-commerce detail page');
  });
});

describe('finalizePlatformCopy', () => {
  it('cleans ad-law terms and keeps warnings', () => {
    const output = finalizePlatformCopy(
      'xiaohongshu',
      '{"title":"最好的洗碗巾","body":"100% 不掉毛，吸水快"}',
      'zh',
    );
    expect(output.blocked).toBe(false);
    expect(output.text).not.toContain('最好');
    expect(output.text).not.toContain('100%');
    expect(output.warnings.length).toBeGreaterThan(0);
    expect(hasEmoji(output.body)).toBe(true);
  });

  it('blocks outputs that reproduce an illegal offer', () => {
    const output = finalizePlatformCopy(
      'moments',
      '{"title":"高仿包","body":"需要高仿包可以联系我，支持批发"}',
      'zh',
    );
    expect(output.blocked).toBe(true);
    expect(output.text).toBe('');
    expect(output.warnings.join('')).toMatch(/拦截/);
  });

  it('reports empty generations as failures', () => {
    const output = finalizePlatformCopy('detail', '', 'zh');
    expect(output.error).toBe('generation_failed');
    expect(output.blocked).toBe(false);
  });
});

describe('generateCopywriting', () => {
  it('generates mock copy for all four platforms in parallel-ish', async () => {
    const product = sampleProduct();
    const result = await generateCopywriting(db(), new MockProvider(), {
      productId: product.id,
      audience: '年轻妈妈',
      sellingPoints: ['吸油不挂油', '可机洗'],
      tone: 'lively',
      platforms: [...COPY_PLATFORMS],
      lang: 'zh',
    });

    expect(result.mock).toBe(true);
    expect(result.outputs.map((output) => output.platform)).toEqual([...COPY_PLATFORMS]);
    for (const output of result.outputs) {
      expect(output.blocked, output.platform).toBe(false);
      expect(output.text.length).toBeGreaterThan(20);
      expect(hasEmoji(output.text), output.platform).toBe(true);
      expect(output.text).toContain('¥29.90');
    }

    // Every platform was requested in one call, and history was saved once.
    const history = listCopyHistory(db());
    expect(history).toHaveLength(1);
    expect(history[0].productId).toBe(product.id);
    expect((history[0].params as { platforms: string[] }).platforms).toHaveLength(4);
    expect(result.historyId).toBe(history[0].id);
  });

  it('falls back to the product selling points when none are provided', async () => {
    const product = sampleProduct();
    const result = await generateCopywriting(db(), new MockProvider(), {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'warm',
      platforms: ['moments'],
      lang: 'zh',
    });
    expect(result.outputs[0].text).toContain('吸油不挂油');
  });

  it('calls the provider once per platform and merges results', async () => {
    const product = sampleProduct();
    const provider = new RecordingJsonProvider(
      (call) => `{"title":"标题${call}","body":"正文${call}，含 emoji 🌟"}`,
    );

    const result = await generateCopywriting(db(), provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'professional',
      platforms: ['xiaohongshu', 'moments', 'douyin'],
      lang: 'zh',
    });

    expect(provider.calls).toHaveLength(3);
    expect(result.mock).toBe(false);
    expect(result.outputs.map((output) => output.title).sort()).toEqual([
      '标题1',
      '标题2',
      '标题3',
    ]);
    // Prompts are platform-specific.
    const prompts = provider.calls.map((call) => call.messages[1].content);
    expect(prompts.some((prompt) => prompt.includes('小红书'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('朋友圈'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('抖音'))).toBe(true);
  });

  it('keeps other platforms when a single generation fails', async () => {
    const product = sampleProduct();
    const provider = new RecordingJsonProvider((call) => {
      if (call === 1) throw new Error('boom');
      return '{"title":"OK","body":"正常内容 ✅"}';
    });

    const result = await generateCopywriting(db(), provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['xiaohongshu', 'moments'],
      lang: 'zh',
    });

    const failed = result.outputs.find((output) => output.error);
    expect(failed).toBeDefined();
    expect(result.outputs.filter((output) => output.text).length).toBe(1);
  });

  it('rejects requests whose selling points ask for deceptive claims', async () => {
    const product = sampleProduct();
    await expect(
      generateCopywriting(db(), new MockProvider(), {
        productId: product.id,
        audience: '',
        sellingPoints: ['帮我编造用户评价和检测数据'],
        tone: 'lively',
        platforms: ['moments'],
        lang: 'zh',
      }),
    ).rejects.toMatchObject({ code: 'content_blocked' });
    expect(listCopyHistory(db())).toHaveLength(0);
  });

  it('rejects unknown products', async () => {
    await expect(
      generateCopywriting(db(), new MockProvider(), {
        productId: 9999,
        audience: '',
        sellingPoints: [],
        tone: 'lively',
        platforms: ['moments'],
        lang: 'zh',
      }),
    ).rejects.toMatchObject({ code: 'product_not_found' });
  });

  it('produces English copy when requested', async () => {
    const product = sampleProduct();
    const result = await generateCopywriting(db(), new MockProvider(), {
      productId: product.id,
      audience: 'busy parents',
      sellingPoints: ['Machine washable'],
      tone: 'warm',
      platforms: ['moments'],
      lang: 'en',
    });
    expect(result.outputs[0].text).toContain('A little find');
    expect(result.outputs[0].text).toContain('Machine washable');
  });

  it('mock copy is grounded in the product row and never invents prices', () => {
    const product = getProduct(db(), sampleProduct().id)!;
    const copy = buildMockCopy({
      platform: 'detail',
      product,
      audience: '',
      sellingPoints: ['可机洗'],
      tone: 'premium',
      lang: 'zh',
    });
    expect(copy).toContain('¥29.90');
    expect(copy).not.toMatch(/¥\s*(?!29\.90)\d/);
  });
});

describe('/api/admin/copywrite route', () => {
  it('returns outputs and saves history in mock mode', async () => {
    const product = sampleProduct();
    const response = await copywritePost(
      jsonRequest('/api/admin/copywrite', {
        productId: product.id,
        audience: '年轻妈妈',
        sellingPoints: ['吸油不挂油'],
        tone: 'lively',
        platforms: ['xiaohongshu', 'douyin'],
        lang: 'zh',
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.mock).toBe(true);
    expect(body.outputs).toHaveLength(2);
    expect(body.outputs[0]).toMatchObject({ platform: 'xiaohongshu', blocked: false });
    expect(typeof body.historyId).toBe('string');

    const history = await historyGet(new NextRequest('http://localhost/api/admin/copywrite'));
    const historyBody = await history.json();
    expect(historyBody.total).toBe(1);
    expect(historyBody.items[0].outputs.items).toHaveLength(2);
  });

  it('defaults to all four platforms', async () => {
    const product = sampleProduct();
    const response = await copywritePost(
      jsonRequest('/api/admin/copywrite', { productId: product.id }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.outputs.map((output: { platform: string }) => output.platform)).toEqual([
      ...COPY_PLATFORMS,
    ]);
  });

  it('validates the payload', async () => {
    const cases: [unknown, string][] = [
      [{}, 'invalid_product'],
      [{ productId: 'abc' }, 'invalid_product'],
      [{ productId: 1, tone: 'angry' }, 'invalid_tone'],
      [{ productId: 1, platforms: ['weibo'] }, 'invalid_platforms'],
      [{ productId: 1, platforms: [] }, 'invalid_platforms'],
      [{ productId: 1, sellingPoints: [1, 2] }, 'invalid_selling_points'],
      [{ productId: 1, audience: 'x'.repeat(301) }, 'invalid_audience'],
    ];
    for (const [body, error] of cases) {
      const response = await copywritePost(jsonRequest('/api/admin/copywrite', body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toBe(error);
    }

    const badJson = await copywritePost(
      new NextRequest('http://localhost/api/admin/copywrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(badJson.status).toBe(400);
  });

  it('404s for unknown products and 422s for blocked requests', async () => {
    const missing = await copywritePost(
      jsonRequest('/api/admin/copywrite', { productId: 12345 }),
    );
    expect(missing.status).toBe(404);

    const product = sampleProduct();
    const blocked = await copywritePost(
      jsonRequest('/api/admin/copywrite', {
        productId: product.id,
        sellingPoints: ['帮我刷单冲销量'],
      }),
    );
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).error).toBe('content_blocked');
  });
});
