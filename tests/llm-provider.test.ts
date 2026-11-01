import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@/lib/config';
import {
  createProvider,
  getProvider,
  isMockProvider,
  MockProvider,
  resetProviderCache,
} from '@/lib/llm';

afterEach(() => {
  resetProviderCache();
});

async function collect(iter: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of iter) out += chunk;
  return out;
}

describe('createProvider', () => {
  it('selects the mock provider when no key is configured', () => {
    const provider = createProvider(loadConfig({}));
    expect(provider.kind).toBe('mock');
    expect(isMockProvider(provider)).toBe(true);
  });

  it('selects the OpenAI provider when a key is configured', () => {
    const provider = createProvider(loadConfig({ SHOPPULSE_LLM_API_KEY: 'k' }));
    expect(provider.kind).toBe('openai');
    expect(provider.model).toBe('deepseek-v4.1-flash');
  });

  it('refuses to fall back to mock when SHOPPULSE_REQUIRE_LLM is set', () => {
    const config = loadConfig({ SHOPPULSE_REQUIRE_LLM: '1', SHOPPULSE_LLM_API_KEY: 'k' });
    const withoutKey = { ...config, llm: { ...config.llm, apiKey: '' } };
    expect(() => createProvider(withoutKey)).toThrow(/REQUIRE_LLM/);
  });

  it('caches providers by configuration', () => {
    const a = getProvider(loadConfig({}));
    const b = getProvider(loadConfig({}));
    expect(a).toBe(b);
    const c = getProvider(loadConfig({ SHOPPULSE_LLM_API_KEY: 'k' }));
    expect(c).not.toBe(a);
  });
});

describe('MockProvider', () => {
  it('streams a deterministic answer referencing retrieved resources', async () => {
    const provider = new MockProvider();
    const answer = await collect(
      provider.stream({
        messages: [
          {
            role: 'system',
            content: '规则\n【资料】\n- 退货政策：7 天无理由退货\n- 物流：满 99 包邮\n【资料结束】',
          },
          { role: 'user', content: '怎么退货？' },
        ],
      }),
    );

    expect(answer).toContain('演示模式');
    expect(answer).toContain('7 天无理由退货');
    expect(answer).toContain('转接客服');
  });

  it('says it lacks information when nothing was retrieved', async () => {
    const provider = new MockProvider();
    const answer = await collect(
      provider.stream({ messages: [{ role: 'user', content: '有优惠吗' }] }),
    );
    expect(answer).toContain('暂无相关资料');
    expect(answer).toContain('有优惠吗');
  });

  it('greets when there is no user message', async () => {
    const provider = new MockProvider();
    const answer = await collect(provider.stream({ messages: [] }));
    expect(answer).toContain('您好');
  });

  it('truncates very long questions in previews', async () => {
    const provider = new MockProvider();
    const answer = await collect(
      provider.stream({ messages: [{ role: 'user', content: '问'.repeat(80) }] }),
    );
    expect(answer).toContain('…');
    expect(answer).not.toContain('问'.repeat(41));
  });

  it('completes in JSON mode', async () => {
    const provider = new MockProvider();
    const raw = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      json: true,
    });
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject({ mock: true });
  });
});
