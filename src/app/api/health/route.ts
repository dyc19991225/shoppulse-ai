import { NextResponse } from 'next/server';

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

function truthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * Liveness/readiness probe. Reports LLM configuration without exposing secrets.
 * When SHOPPULSE_REQUIRE_LLM is set and no API key is present the service is
 * considered misconfigured (503) and mock mode is not offered.
 */
export function GET(): NextResponse<HealthPayload> {
  const hasApiKey = Boolean(process.env.SHOPPULSE_LLM_API_KEY?.trim());
  const requireLlm = truthy(process.env.SHOPPULSE_REQUIRE_LLM);
  const mode = hasApiKey ? 'llm' : requireLlm ? 'misconfigured' : 'mock';

  const payload: HealthPayload = {
    ok: mode !== 'misconfigured',
    service: 'shoppulse-ai',
    version: '0.1.0',
    llm: {
      mode,
      requireLlm,
      hasApiKey,
      model: process.env.SHOPPULSE_LLM_MODEL?.trim() || 'deepseek-v4.1-flash',
    },
    time: new Date().toISOString(),
  };

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}
