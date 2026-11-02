import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

const ENV_KEYS = [
  'SHOPPULSE_LLM_API_KEY',
  'SHOPPULSE_LLM_MODEL',
  'SHOPPULSE_REQUIRE_LLM',
] as const;

// The developer shell may export a real key (e.g. for T12 gateway checks);
// these tests assert on a clean environment.
function clearLlmEnv(): void {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clearLlmEnv);

afterEach(clearLlmEnv);

describe('GET /api/health', () => {
  it('reports mock mode when no API key is configured', async () => {
    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('shoppulse-ai');
    expect(body.llm).toMatchObject({
      mode: 'mock',
      requireLlm: false,
      hasApiKey: false,
      model: 'deepseek-v4.1-flash',
    });
  });

  it('reports llm mode and hides the key when configured', async () => {
    vi.stubEnv('SHOPPULSE_LLM_API_KEY', 'test-key-not-real');
    vi.stubEnv('SHOPPULSE_LLM_MODEL', 'some-model');

    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.llm).toMatchObject({ mode: 'llm', hasApiKey: true, model: 'some-model' });
    expect(JSON.stringify(body)).not.toContain('test-key-not-real');
  });

  it('returns 503 when LLM is required but the key is missing', async () => {
    vi.stubEnv('SHOPPULSE_REQUIRE_LLM', '1');

    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.llm.mode).toBe('misconfigured');
  });
});
