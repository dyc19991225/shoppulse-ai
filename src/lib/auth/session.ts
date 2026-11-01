/**
 * Stateless HMAC-signed sessions that work in both the Node.js runtime and the
 * Edge middleware (Web Crypto only, no Node imports).
 *
 * Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 */

export const SESSION_COOKIE = 'shoppulse_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  /** Username. */
  sub: string;
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expires at (epoch seconds). */
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  subject: string,
  secret: string,
  options: { now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  if (!secret) throw new Error('Session secret is required');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;

  const payload: SessionPayload = { sub: subject, iat: now, exp: now + ttl };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export type SessionVerification =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifySession(
  token: string | undefined | null,
  secret: string,
  options: { now?: number } = {},
): Promise<SessionVerification> {
  if (!token || !secret) return { valid: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    return { valid: false, reason: 'malformed' };
  }

  const payloadPart = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signaturePart);
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    signature as BufferSource,
    new TextEncoder().encode(payloadPart),
  );
  if (!ok) return { valid: false, reason: 'bad_signature' };

  let payload: SessionPayload;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (
      !decoded ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.exp !== 'number' ||
      typeof decoded.iat !== 'number'
    ) {
      return { valid: false, reason: 'malformed' };
    }
    payload = decoded as SessionPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return { valid: false, reason: 'expired' };

  return { valid: true, payload };
}

/** Cookie options shared by login and logout handlers. */
export function sessionCookieOptions(isProduction: boolean): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
