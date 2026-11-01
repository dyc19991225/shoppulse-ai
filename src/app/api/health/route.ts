import { NextResponse } from 'next/server';
import { ConfigError, loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export interface HealthPayload {
  ok: boolean;
  service: 'shoppulse-ai';
  version: string;
  llm: {
    mode: 'llm' | 'mock' | 'misconfigured';
    requireLlm: boolean;
    hasApiKey: boolean;
    model: string;
  };
  time: string;
}

/**
 * Liveness/readiness probe. Reports LLM configuration without exposing secrets.
 * When SHOPPULSE_REQUIRE_LLM is set and no API key is present the service is
 * considered misconfigured (503) and mock mode is not offered.
 */
export function GET(): NextResponse<HealthPayload> {
  const hasApiKey = Boolean(process.env.SHOPPULSE_LLM_API_KEY?.trim());
  const requireLlm =
    process.env.SHOPPULSE_REQUIRE_LLM === '1' ||
    process.env.SHOPPULSE_REQUIRE_LLM?.toLowerCase() === 'true';
  const model = process.env.SHOPPULSE_LLM_MODEL?.trim() || 'deepseek-v4.1-flash';

  let mode: HealthPayload['llm']['mode'] = hasApiKey ? 'llm' : 'mock';
  if (!hasApiKey && requireLlm) mode = 'misconfigured';

  try {
    // Full config validation catches other production misconfigurations
    // (missing SESSION_SECRET / ADMIN_PASSWORD_HASH).
    loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      mode = 'misconfigured';
    } else {
      throw error;
    }
  }

  const payload: HealthPayload = {
    ok: mode !== 'misconfigured',
    service: 'shoppulse-ai',
    version: '0.1.0',
    llm: { mode, requireLlm, hasApiKey, model },
    time: new Date().toISOString(),
  };

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}
