import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { getDb, resetDbCache } from '@/lib/db-runtime';

const ENV_KEYS = [
  'SHOPPULSE_LLM_API_KEY',
  'SHOPPULSE_LLM_MODEL',
  'SHOPPULSE_REQUIRE_LLM',
] as const;

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-health-'));
  tempDirs.push(dir);
  return path.join(dir, 'health.db');
}

// The developer shell may export a real key (e.g. for T12 gateway checks);
// these tests assert on a clean environment.
function clearLlmEnv(): void {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clearLlmEnv);

afterEach(() => {
  clearLlmEnv();
  resetDbCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

  it.each(['1', 'true', 'yes', 'on'])(
    'returns 503 when LLM is required (%s) but the key is missing',
    async (value) => {
      vi.stubEnv('SHOPPULSE_REQUIRE_LLM', value);

      const res = GET();
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.llm.mode).toBe('misconfigured');
      expect(body.llm.requireLlm).toBe(true);
    },
  );

  it('reports misconfigured for yes/on spellings instead of a healthy mock mode', async () => {
    for (const value of ['yes', 'on']) {
      vi.stubEnv('SHOPPULSE_REQUIRE_LLM', value);
      const res = GET();
      const body = await res.json();
      expect(res.status, value).toBe(503);
      expect(body.llm, value).toMatchObject({ mode: 'misconfigured', requireLlm: true });
    }
  });

  it('still answers when REQUIRE_LLM is set without a key and the DB is requested', async () => {
    vi.stubEnv('SHOPPULSE_REQUIRE_LLM', '1');
    vi.stubEnv('SHOPPULSE_DB_PATH', tempDbPath());

    // Core config/DB loading must not throw just because the LLM is not ready.
    expect(() => getDb()).not.toThrow();

    const res = GET();
    expect(res.status).toBe(503);
    expect((await res.json()).llm.mode).toBe('misconfigured');
  });
});
