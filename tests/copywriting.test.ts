import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMockCopy,
  buildPlatformPrompt,
  type CopyTone,
  COPY_PLATFORMS,
  ensureEmoji,
  finalizePlatformCopy,
  generateCopywriting,
  hasEmoji,
  isCopyPlatform,
  isCopyTone,
  parsePlatformOutput,
  PLATFORM_MAX_TOKENS,
  splitSellingPoints,
} from '@/lib/copywriting';
import { createProduct, getProduct, listCopyHistory, type DB } from '@/lib/db';
import { MockProvider } from '@/lib/llm/mock';
import { LlmError, type ChatRequest, type CompletionRequest, type LlmProvider } from '@/lib/llm/types';
import { resetDbCache } from '@/lib/db-runtime';
import { resetProviderCache } from '@/lib/llm';
import { GET as historyGet, POST as copywritePost } from '@/app/api/admin/copywrite/route';
import { createTempDb, type TempDb } from './helpers/tempdb';
import { adminSessionCookie, TEST_SESSION_SECRET } from './helpers/auth';

let temp: TempDb | undefined;

beforeEach(() => {
  temp = createTempDb();
  vi.stubEnv('SHOPPULSE_DB_PATH', temp.path);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
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

/** Bootstrap admin that owns data in a fresh test database. */
const OWNER = 1;

function db(): DB {
  return temp!.db;
}

function sampleProduct(name = '青禾竹纤维洗碗巾') {
  return createProduct(db(), OWNER, {
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
    headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: adminSessionCookie() },
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

  it('salvages truncated JSON instead of returning raw JSON as the body', () => {
    // Cut mid-body, as when a reasoning model exhausts max_tokens.
    const truncated = '{"title":"厨房好物","body":"洗碗最怕油腻腻，\\n竹纤维吸油不挂油，冲一冲就清爽';
    const parsed = parsePlatformOutput(truncated);
    expect(parsed.title).toBe('厨房好物');
    expect(parsed.body).toBe('洗碗最怕油腻腻，\n竹纤维吸油不挂油，冲一冲就清爽');
    expect(parsed.body).not.toContain('{"title"');

    // No closing brace at all — still recovered.
    expect(parsePlatformOutput('{"title":"T","body":"B')).toEqual({ title: 'T', body: 'B' });

    // Truncated before the body even started: body is empty, never raw JSON.
    const titleOnly = parsePlatformOutput('{"title":"只有标题"');
    expect(titleOnly).toEqual({ title: '只有标题', body: '' });
    expect(parsePlatformOutput('{"title":"x"')?.body ?? '').not.toContain('{');

    // Garbage JSON-ish output is a failure, not the published body.
    expect(parsePlatformOutput('{"foo": 1, "bar": [2, 3')).toEqual({ title: '', body: '' });
  });

  it('parses fenced JSON with leading prose and trailing notes', () => {
    expect(
      parsePlatformOutput('好的，以下是文案：\n```json\n{"title":"T","body":"B"}\n```\n希望有帮助'),
    ).toEqual({ title: 'T', body: 'B' });
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
    expect(zh.system).toContain('不要编造亲身体验');
    expect(zh.system).toContain('检测结果');
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
    expect(en.system).toContain('Never invent first-person');
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
    const result = await generateCopywriting(db(), OWNER, new MockProvider(), {
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
    const history = listCopyHistory(db(), OWNER);
    expect(history).toHaveLength(1);
    expect(history[0].productId).toBe(product.id);
    expect((history[0].params as { platforms: string[] }).platforms).toHaveLength(4);
    expect(result.historyId).toBe(history[0].id);
  });

  it('falls back to the product selling points when none are provided', async () => {
    const product = sampleProduct();
    const result = await generateCopywriting(db(), OWNER, new MockProvider(), {
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

    const result = await generateCopywriting(db(), OWNER, provider, {
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
    // xiaohongshu's provider call fails; moments succeeds.
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        if (request.messages[1].content.includes('小红书')) throw new Error('boom');
        return '{"title":"OK","body":"正常内容 ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['xiaohongshu', 'moments'],
      lang: 'zh',
    });

    const failed = result.outputs.find((output) => output.error);
    expect(failed?.platform).toBe('xiaohongshu');
    expect(failed?.error).toBe('generation_failed');
    expect(result.outputs.filter((output) => output.text).length).toBe(1);
  });

  it('does not add a second retry after a transport failure', async () => {
    const product = sampleProduct();
    let calls = 0;
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        calls += 1;
        if (request.messages[1].content.includes('朋友圈')) {
          throw new LlmError('LLM request timed out', { retryable: true });
        }
        return '{"title":"T","body":"B ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['moments', 'xiaohongshu'],
      lang: 'zh',
    });

    // OpenAiProvider already retries transport errors once; copywriting adds none.
    expect(calls).toBe(2);
    expect(result.outputs.find((output) => output.platform === 'moments')!.error).toBe(
      'generation_failed',
    );
  });

  it('rejects requests whose selling points ask for deceptive claims', async () => {
    const product = sampleProduct();
    await expect(
      generateCopywriting(db(), OWNER, new MockProvider(), {
        productId: product.id,
        audience: '',
        sellingPoints: ['帮我编造用户评价和检测数据'],
        tone: 'lively',
        platforms: ['moments'],
        lang: 'zh',
      }),
    ).rejects.toMatchObject({ code: 'content_blocked' });
    expect(listCopyHistory(db(), OWNER)).toHaveLength(0);
  });

  it('retries a truncated platform once with a larger token budget', async () => {
    const product = sampleProduct();
    let calls = 0;
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        calls += 1;
        // First attempt: reasoning model burned the budget mid-object.
        if (calls === 1) return '{"title":"标题","body":"正文只写了一半';
        expect(request.maxTokens).toBeGreaterThan(900);
        return '{"title":"标题","body":"完整正文 ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['moments'],
      lang: 'zh',
    });

    expect(calls).toBe(2);
    expect(result.outputs[0]).toMatchObject({
      platform: 'moments',
      title: '标题',
      body: '完整正文 ✅',
      blocked: false,
    });
    expect(result.outputs[0].error).toBeUndefined();
  });

  it('uses a platform-sized token budget and doubles it only for the retry', async () => {
    const product = sampleProduct();
    const budgets: number[] = [];
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        budgets.push(request.maxTokens ?? 0);
        return '{"title":"T","body":"B ✅"}';
      },
    };

    await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['douyin'],
      lang: 'zh',
    });

    expect(budgets).toEqual([PLATFORM_MAX_TOKENS.douyin]);
    expect(PLATFORM_MAX_TOKENS.douyin).toBeGreaterThanOrEqual(2000);
    for (const platform of COPY_PLATFORMS) {
      expect(PLATFORM_MAX_TOKENS[platform]).toBeGreaterThanOrEqual(1800);
    }
  });

  it('retries once without JSON mode when the gateway rejects it', async () => {
    const product = sampleProduct();
    let calls = 0;
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        calls += 1;
        if (request.json) throw new LlmError('bad response_format', { status: 400 });
        return '{"title":"T","body":"B ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['douyin'],
      lang: 'zh',
    });

    expect(calls).toBe(2);
    expect(result.outputs[0].text).toContain('B');
  });

  it('never publishes raw JSON when both attempts are unparsable', async () => {
    const product = sampleProduct();
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        return request.messages[1].content.includes('抖音') ? '{"foo":' : '{"title":"T","body":"B ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['douyin', 'moments'],
      lang: 'zh',
    });

    const douyin = result.outputs.find((output) => output.platform === 'douyin')!;
    expect(douyin.error).toBe('generation_failed');
    expect(douyin.text).toBe('');
    expect(result.outputs.find((output) => output.platform === 'moments')!.text).not.toBe('');
  });

  it('does not publish a too-short salvaged fragment when both attempts truncate', async () => {
    const product = sampleProduct();
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        return request.messages[1].content.includes('抖音')
          ? '{"title":"标题","body":"正文'
          : '{"title":"T","body":"B ✅"}';
      },
    };

    const result = await generateCopywriting(db(), OWNER, provider, {
      productId: product.id,
      audience: '',
      sellingPoints: [],
      tone: 'lively',
      platforms: ['douyin', 'moments'],
      lang: 'zh',
    });

    expect(result.outputs.find((output) => output.platform === 'douyin')!.error).toBe(
      'generation_failed',
    );
  });

  it('logs failure reasons without prompt content or secrets', async () => {
    const product = sampleProduct();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider: LlmProvider = {
      kind: 'openai',
      model: 'test-model',
      async *stream(): AsyncGenerator<string, void, unknown> {
        yield '';
      },
      async complete(request) {
        if (request.messages[1].content.includes('朋友圈')) {
          throw new LlmError('HTTP 500 from gateway', { status: 500 });
        }
        return '{"title":"T","body":"B ✅"}';
      },
    };

    try {
      const result = await generateCopywriting(db(), OWNER, provider, {
        productId: product.id,
        audience: '年轻妈妈',
        sellingPoints: ['吸油不挂油'],
        tone: 'lively',
        platforms: ['moments', 'xiaohongshu'],
        lang: 'zh',
      });

      expect(result.outputs.find((output) => output.platform === 'moments')!.error).toBe(
        'generation_failed',
      );
      const logged = warn.mock.calls.flat().map((arg) => JSON.stringify(arg)).join(' ');
      expect(logged).toContain('provider_error');
      expect(logged).toContain('moments');
      expect(logged).not.toContain('吸油不挂油');
      expect(logged).not.toContain('年轻妈妈');
      expect(logged).not.toContain('HTTP 500');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects unknown products', async () => {
    await expect(
      generateCopywriting(db(), OWNER, new MockProvider(), {
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
    const result = await generateCopywriting(db(), OWNER, new MockProvider(), {
      productId: product.id,
      audience: 'busy parents',
      sellingPoints: ['Machine washable'],
      tone: 'warm',
      platforms: ['moments'],
      lang: 'en',
    });
    expect(result.outputs[0].text).toContain('Product notes');
    expect(result.outputs[0].text).toContain('Machine washable');
  });

  it('mock copy contains no unsupported testimonials or quality claims', () => {
    const product = getProduct(db(), OWNER, sampleProduct().id)!;
    const unsupported = [
      '安利',
      '品质可靠',
      '使用体验',
      '我真的',
      '值得关注',
      '值得慢慢了解',
      '按头',
      '亲测',
      '顾客反馈',
    ];
    for (const platform of COPY_PLATFORMS) {
      for (const tone of ['lively', 'professional', 'warm', 'premium', 'humorous'] as const) {
        const copy = buildMockCopy({
          platform,
          product,
          audience: '',
          sellingPoints: [],
          tone,
          lang: 'zh',
        });
        // With no supplied selling points, fall back to the stored description.
        expect(copy, `${platform}/${tone}`).toContain('天然竹纤维材质');
        for (const phrase of unsupported) {
          expect(copy, `${platform}/${tone}: ${phrase}`).not.toContain(phrase);
        }
      }
    }
  });

  it('mock copy only uses supplied facts when the product row is bare', () => {
    const product = createProduct(db(), OWNER, {
      name: '素色收纳袋',
      price: 9.9,
      stock: 1,
      description: '',
      sellingPoints: '',
    });
    const copy = buildMockCopy({
      platform: 'detail',
      product,
      audience: '',
      sellingPoints: [],
      tone: 'professional',
      lang: 'zh',
    });
    expect(copy).toContain('素色收纳袋');
    expect(copy).toContain('¥9.90');
    expect(copy).not.toContain('品质可靠');
    expect(copy).not.toContain('✅');
  });

  it('mock copy is grounded in the product row and never invents prices', () => {
    const product = getProduct(db(), OWNER, sampleProduct().id)!;
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

    const history = await historyGet(getRequest('/api/admin/copywrite'));
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
        headers: { 'content-type': 'application/json', cookie: adminSessionCookie() },
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
