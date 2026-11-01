import path from 'node:path';

export interface AppConfig {
  dbPath: string;
  llm: {
    baseUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    requireLlm: boolean;
  };
  admin: {
    username: string;
    passwordHash: string;
    password: string;
  };
  sessionSecret: string;
  isProduction: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Accepts 1/true/yes/on (case-insensitive) as truthy. */
export function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Parses a positive integer, falling back when unset; rejects garbage. */
export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string {
  return value?.trim() ?? '';
}

/**
 * Builds the app config from environment variables.
 * Never logs or returns key material beyond what the caller needs.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';

  const requireLlm = parseBool(env.SHOPPULSE_REQUIRE_LLM, false);
  const apiKey = nonEmpty(env.SHOPPULSE_LLM_API_KEY);

  if (requireLlm && !apiKey) {
    throw new ConfigError(
      'SHOPPULSE_REQUIRE_LLM is set but SHOPPULSE_LLM_API_KEY is missing',
    );
  }

  const baseUrl = nonEmpty(env.SHOPPULSE_LLM_BASE_URL) || 'http://192.74.249.13:8788/v1';
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new ConfigError(`SHOPPULSE_LLM_BASE_URL must be an http(s) URL, got "${baseUrl}"`);
  }

  const dbPath = nonEmpty(env.SHOPPULSE_DB_PATH) || './data/shoppulse.db';

  const sessionSecret = nonEmpty(env.SESSION_SECRET);
  if (isProduction && !sessionSecret) {
    throw new ConfigError('SESSION_SECRET is required in production');
  }

  const passwordHash = nonEmpty(env.ADMIN_PASSWORD_HASH);
  const password = nonEmpty(env.ADMIN_PASSWORD);
  if (isProduction && !passwordHash) {
    throw new ConfigError('ADMIN_PASSWORD_HASH is required in production');
  }

  return {
    dbPath: path.resolve(dbPath),
    llm: {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model: nonEmpty(env.SHOPPULSE_LLM_MODEL) || 'deepseek-v4.1-flash',
      apiKey,
      timeoutMs: parsePositiveInt(
        env.SHOPPULSE_LLM_TIMEOUT_MS,
        60_000,
        'SHOPPULSE_LLM_TIMEOUT_MS',
      ),
      requireLlm,
    },
    admin: {
      username: nonEmpty(env.ADMIN_USERNAME) || 'admin',
      passwordHash,
      password: isProduction ? '' : password,
    },
    sessionSecret,
    isProduction,
  };
}

/** True when the LLM should be used (key present). Mock mode otherwise. */
export function shouldUseLlm(config: Pick<AppConfig, 'llm'>): boolean {
  return Boolean(config.llm.apiKey);
}
