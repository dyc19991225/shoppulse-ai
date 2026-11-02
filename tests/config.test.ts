import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseBool, parsePositiveInt } from '@/lib/config';

describe('parseBool', () => {
  it('accepts common truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(parseBool(value)).toBe(true);
    }
  });

  it('treats unset/empty/false as false', () => {
    expect(parseBool(undefined)).toBe(false);
    expect(parseBool('')).toBe(false);
    expect(parseBool('0')).toBe(false);
    expect(parseBool('false')).toBe(false);
  });

  it('uses fallback for undefined', () => {
    expect(parseBool(undefined, true)).toBe(true);
  });
});

describe('parsePositiveInt', () => {
  it('parses valid integers', () => {
    expect(parsePositiveInt('5000', 1000, 'X')).toBe(5000);
  });

  it('falls back when unset', () => {
    expect(parsePositiveInt(undefined, 42, 'X')).toBe(42);
  });

  it('rejects non-positive or non-integer input', () => {
    expect(() => parsePositiveInt('0', 42, 'X')).toThrow(ConfigError);
    expect(() => parsePositiveInt('-1', 42, 'X')).toThrow(ConfigError);
    expect(() => parsePositiveInt('1.5', 42, 'X')).toThrow(ConfigError);
    expect(() => parsePositiveInt('abc', 42, 'X')).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({});

    expect(config.dbPath.endsWith('data/shoppulse.db')).toBe(true);
    expect(config.llm.baseUrl).toBe('http://192.74.249.13:8788/v1');
    expect(config.llm.model).toBe('deepseek-v4.1-flash');
    expect(config.llm.apiKey).toBe('');
    expect(config.llm.timeoutMs).toBe(60_000);
    expect(config.llm.requireLlm).toBe(false);
    expect(config.admin.username).toBe('admin');
    expect(config.isProduction).toBe(false);
  });

  it('reads configured values and strips trailing slashes from base URL', () => {
    const config = loadConfig({
      SHOPPULSE_DB_PATH: '/tmp/custom.db',
      SHOPPULSE_LLM_BASE_URL: 'https://example.com/v1///',
      SHOPPULSE_LLM_MODEL: 'my-model',
      SHOPPULSE_LLM_API_KEY: 'secret-value',
      SHOPPULSE_LLM_TIMEOUT_MS: '1234',
      SHOPPULSE_REQUIRE_LLM: '1',
      ADMIN_USERNAME: 'boss',
    });

    expect(config.dbPath).toBe('/tmp/custom.db');
    expect(config.llm.baseUrl).toBe('https://example.com/v1');
    expect(config.llm.model).toBe('my-model');
    expect(config.llm.apiKey).toBe('secret-value');
    expect(config.llm.timeoutMs).toBe(1234);
    expect(config.llm.requireLlm).toBe(true);
    expect(config.admin.username).toBe('boss');
  });

  it('rejects a non-http(s) LLM base URL', () => {
    expect(() => loadConfig({ SHOPPULSE_LLM_BASE_URL: 'ftp://nope' })).toThrow(ConfigError);
  });

  it('rejects requiring the LLM without a key', () => {
    expect(() => loadConfig({ SHOPPULSE_REQUIRE_LLM: '1' })).toThrow(/SHOPPULSE_LLM_API_KEY/);
    // yes/on are accepted just like 1/true.
    expect(() => loadConfig({ SHOPPULSE_REQUIRE_LLM: 'yes' })).toThrow(/SHOPPULSE_LLM_API_KEY/);
    expect(() => loadConfig({ SHOPPULSE_REQUIRE_LLM: 'on' })).toThrow(/SHOPPULSE_LLM_API_KEY/);
  });

  it('can skip LLM readiness so core config/DB loading still succeeds', () => {
    const config = loadConfig(
      { SHOPPULSE_REQUIRE_LLM: '1', SHOPPULSE_DB_PATH: '/tmp/core.db' },
      { checkLlmReady: false },
    );
    expect(config.llm.requireLlm).toBe(true);
    expect(config.llm.apiKey).toBe('');
    expect(config.dbPath).toBe('/tmp/core.db');
  });

  it('requires session secret and password hash in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x' }),
    ).toThrow(/ADMIN_PASSWORD_HASH/);
  });

  it('never exposes the plaintext admin password in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'x',
      ADMIN_PASSWORD_HASH: 'a:b',
      ADMIN_PASSWORD: 'plaintext',
    });
    expect(config.admin.password).toBe('');
  });
});
