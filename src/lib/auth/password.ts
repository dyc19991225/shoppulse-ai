import crypto from 'node:crypto';

/** scrypt parameters (N=16384, r=8, p=1) => 32-byte key. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** Format: `saltHex:hashHex`, each 16 and 32 bytes. */
export function hashPasswordSync(password: string): string {
  if (!password) throw new Error('Password must not be empty');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!password) {
      reject(new Error('Password must not be empty'));
      return;
    }
    const salt = crypto.randomBytes(16);
    crypto.scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, derived) => {
        if (error) reject(error);
        else resolve(`${salt.toString('hex')}:${derived.toString('hex')}`);
      },
    );
  });
}

/**
 * Constant-time verification of a password against a `salt:hash` string.
 * Returns false for malformed stored hashes instead of throwing.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!password || !stored) return false;
  const parts = stored.trim().split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Constant-time string compare for usernames / tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a compare to avoid obvious length timing clues.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
