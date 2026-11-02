import { NextResponse } from 'next/server';

/** Consistent JSON error envelope used by all admin APIs. */
export function jsonError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status });
}

export async function readJsonObject(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json') };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: jsonError(400, 'invalid_json') };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

export function asString(value: unknown, maxLength = 10_000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

/** Returns '' for absent values, null for invalid ones (wrong type / too long). */
export function asOptionalString(value: unknown, maxLength = 10_000): string | null {
  if (value === undefined || value === null) return '';
  if (value === '') return '';
  return asString(value, maxLength);
}

export function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

export function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** True when SQLite rejected a duplicate SKU for the same owner (v2 schema). */
export function isUniqueSkuError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/UNIQUE constraint failed: products\.owner_id, products\.sku/i.test(error.message) ||
      // v1 (global UNIQUE(sku)) keeps the old message shape.
      /UNIQUE constraint failed: products\.sku/i.test(error.message))
  );
}

/** Only http(s) links are accepted for product images / pages. */
export function isSafeHttpUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
