import { NextResponse } from 'next/server';
import { ConfigError, loadConfig, parseBool } from '@/lib/config';

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
  const requireLlm = parseBool(process.env.SHOPPULSE_REQUIRE_LLM);
  const model = process.env.SHOPPULSE_LLM_MODEL?.trim() || 'deepseek-v4.1-flash';

  let mode: HealthPayload['llm']['mode'] = hasApiKey ? 'llm' : 'mock';
  if (!hasApiKey && requireLlm) mode = 'misconfigured';

  try {
    // Core config validation catches other production misconfigurations
    // (missing SESSION_SECRET / ADMIN_PASSWORD_HASH). LLM readiness is
    // derived above so a missing key never prevents the probe from answering.
    loadConfig(undefined, { checkLlmReady: false });
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
