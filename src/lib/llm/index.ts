import type { AppConfig } from '../config';
import { ConfigError } from '../config';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';
import type { LlmProvider } from './types';

export * from './types';
export { MockProvider } from './mock';
export { OpenAiProvider } from './openai';
export { SseParser, parseChatCompletionChunk } from './sse';

export interface ProviderOptions {
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Simulated latency for the mock provider (default 0). */
  mockDelayMs?: number;
}

export type ProviderConfig = Pick<AppConfig, 'llm'>;

/**
 * Chooses the provider:
 * - API key present -> OpenAI-compatible gateway.
 * - No key, SHOPPULSE_REQUIRE_LLM off -> deterministic mock.
 * - No key, SHOPPULSE_REQUIRE_LLM on -> ConfigError (never silently mock).
 */
export function createProvider(
  config: ProviderConfig,
  options: ProviderOptions = {},
): LlmProvider {
  if (config.llm.apiKey) {
    return new OpenAiProvider({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      timeoutMs: config.llm.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  if (config.llm.requireLlm) {
    throw new ConfigError(
      'SHOPPULSE_REQUIRE_LLM is enabled but SHOPPULSE_LLM_API_KEY is not configured',
    );
  }

  return new MockProvider({ model: `mock:${config.llm.model}`, delayMs: options.mockDelayMs });
}

let cached: { key: string; provider: LlmProvider } | null = null;

/** Process-wide provider cache, keyed by the relevant env values. */
export function getProvider(config: ProviderConfig): LlmProvider {
  const key = [
    config.llm.baseUrl,
    config.llm.model,
    config.llm.apiKey,
    config.llm.timeoutMs,
    config.llm.requireLlm,
  ].join('|');
  if (!cached || cached.key !== key) {
    cached = { key, provider: createProvider(config) };
  }
  return cached.provider;
}

/** Test helper. */
export function resetProviderCache(): void {
  cached = null;
}

export function isMockProvider(provider: LlmProvider): boolean {
  return provider.kind === 'mock';
}
