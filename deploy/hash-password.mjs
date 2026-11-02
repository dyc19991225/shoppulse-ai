#!/usr/bin/env node
// Generate an ADMIN_PASSWORD_HASH without the dev toolchain (no tsx needed).
// Matches src/lib/auth/password.ts: scrypt N=16384 r=8 p=1, salt:hash hex.
//
//   node deploy/hash-password.mjs --stdin   # echo 'pw' | ...
//   node deploy/hash-password.mjs 'pw'      # visible in shell history — avoid
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function usage() {
  console.error(`Usage: node deploy/hash-password.mjs --stdin
       echo 'your-password' | node deploy/hash-password.mjs --stdin
       node deploy/hash-password.mjs 'your-password'

Writes salt:hash to stdout for ADMIN_PASSWORD_HASH. Prefer --stdin so the
password never lands in shell history. Never commit the output.`);
}

function readPassword() {
  const args = process.argv.slice(2);
  if (args[0] === '-h' || args[0] === '--help') {
    usage();
    process.exit(0);
  }
  if (args[0] === '--stdin') {
    return readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  }
  if (args.length === 1 && args[0] && !args[0].startsWith('-')) {
    return args[0];
  }
  usage();
  process.exit(1);
}

const password = readPassword();
if (!password) {
  console.error('error: password must not be empty');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, KEY_LENGTH, {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
});

process.stdout.write(`${salt.toString('hex')}:${hash.toString('hex')}\n`);
