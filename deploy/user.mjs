#!/usr/bin/env node
// Manage ShopPulse users on a migrated (schema v2) database without the app
// toolchain. Runs inside the standalone release, where better-sqlite3 lives in
// ../node_modules; no tsx or source tree needed.
//
//   node deploy/user.mjs list [--db PATH]
//   node deploy/user.mjs add <username> --out FILE [--role user|admin]
//                              [--site-origin https://shop.example.com]
//   node deploy/user.mjs reset-password <username> --out FILE
//   node deploy/user.mjs disable <username>
//   node deploy/user.mjs enable <username>
//
// --db defaults to $SHOPPULSE_DB_PATH. Generated passwords are appended to the
// --out file (created 0600) as "username<TAB>password" and are never printed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Must match src/lib/auth/password.ts: scrypt N=16384 r=8 p=1, 32-byte key,
// stored as saltHex:hashHex.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const DEFAULT_SITE_NAME = '默认站点';
const DEFAULT_SITE_RATE_LIMIT = 30;
const PASSWORD_BYTES = 18; // 24 base64url characters (144 bits)

const here = path.dirname(fileURLToPath(import.meta.url));

function usageText() {
  return `Usage: node deploy/user.mjs <command> [args] [--db PATH]

Commands:
  list                                  Show users (id, username, role, disabled, created_at)
  add <username> --out FILE [--role user|admin] [--site-origin URL]
                                        Create a user, a default site and a password
  reset-password <username> --out FILE  Set a new password and sign the user out
  disable <username>                    Disable sign-in and sign the user out
  enable <username>                     Allow sign-in again

--db defaults to $SHOPPULSE_DB_PATH. Passwords are appended to FILE (mode 0600)
and never printed. The database must already be migrated to schema v2.`;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { siteOrigins: [] };
  const positionals = [];
  const valueFlags = new Set(['--db', '--out', '--role', '--site-origin']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      if (!valueFlags.has(name)) fail(`unknown option: ${arg}`);
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        i += 1;
        if (i >= argv.length) fail(`${name} requires a value`);
        value = argv[i];
      }
      if (name === '--db') options.db = value;
      else if (name === '--out') options.out = value;
      else if (name === '--role') options.role = value;
      else options.siteOrigins.push(value);
      continue;
    }
    if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    positionals.push(arg);
  }

  return { options, positionals };
}

/** Loads better-sqlite3 from the release layout (deploy/../node_modules). */
async function loadDatabase() {
  try {
    return (await import('better-sqlite3')).default;
  } catch {
    const modulePath = path.join(here, '..', 'node_modules', 'better-sqlite3', 'lib', 'index.js');
    try {
      return (await import(pathToFileURL(modulePath).href)).default;
    } catch {
      fail('better-sqlite3 not found; run this script from a ShopPulse release');
    }
  }
}

function openDatabase(Database, dbPath) {
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch (error) {
    fail(`cannot open database ${dbPath}: ${error.message}`);
  }

  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true });
  if (version < 2) {
    db.close();
    fail(`database ${dbPath} is schema v${version}; v2 is required — start the service once to migrate`);
  }
  return db;
}

function requireArgs(args, count, usage) {
  if (args.length !== count) fail(`usage: node deploy/user.mjs ${usage}`);
}

/** 24 URL-safe characters from the CSPRNG, independent of umask or shell. */
function generatePassword() {
  return crypto.randomBytes(PASSWORD_BYTES).toString('base64url');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Opens (or creates) the credentials file and forces owner-only permissions. */
function openCredentialsFile(outPath) {
  if (!outPath) fail('--out FILE is required (passwords are never printed)');
  let fd;
  try {
    fd = fs.openSync(outPath, 'a', 0o600);
    fs.fchmodSync(fd, 0o600);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fail(`cannot open --out file: ${outPath} (${error.message})`);
  }
  return fd;
}

function appendCredentials(fd, username, password) {
  try {
    fs.writeSync(fd, `${username}\t${password}\n`);
  } catch {
    fail('failed to write the password file; run reset-password to issue a new one');
  }
}

function findUser(db, username) {
  const user = db
    .prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (!user) fail(`user not found: ${username}`);
  return user;
}

function parseSiteOrigins(values) {
  const origins = [];
  for (const value of values) {
    for (const entry of String(value).split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      let url;
      try {
        url = new URL(trimmed);
      } catch {
        fail(`invalid --site-origin: ${trimmed}`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        fail(`--site-origin must be an http(s) origin: ${trimmed}`);
      }
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        fail(`--site-origin must not contain a path, query or fragment: ${trimmed}`);
      }
      const normalized = trimmed.replace(/\/+$/, '').toLowerCase();
      if (!origins.includes(normalized)) origins.push(normalized);
    }
  }
  return origins;
}

function generateUniqueSiteKey(db) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const siteKey = crypto.randomBytes(7).toString('hex');
    const taken = db.prepare('SELECT 1 FROM sites WHERE site_key = ?').get(siteKey);
    if (!taken) return siteKey;
  }
  throw new Error('could not generate a unique site key');
}

function listUsers(db, args) {
  requireArgs(args, 0, 'list');
  const rows = db
    .prepare('SELECT id, username, role, disabled, created_at FROM users ORDER BY id')
    .all();

  console.log('id\tusername\trole\tdisabled\tcreated_at');
  for (const row of rows) {
    console.log(`${row.id}\t${row.username}\t${row.role}\t${row.disabled ? 1 : 0}\t${row.created_at}`);
  }
}

function addUser(db, args, options) {
  requireArgs(
    args,
    1,
    'add <username> --out FILE [--role user|admin] [--site-origin URL]',
  );
  const username = args[0];
  if (!USERNAME_RE.test(username)) {
    fail('username must be 2-32 characters: lowercase letters, digits, "_", "." or "-", starting with a letter or digit');
  }

  const role = options.role ?? 'user';
  if (role !== 'user' && role !== 'admin') fail('--role must be "user" or "admin"');
  const origins = parseSiteOrigins(options.siteOrigins);

  const existing = db
    .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (existing) fail(`user "${username}" already exists`);

  const fd = openCredentialsFile(options.out);
  try {
    const password = generatePassword();
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();
    let userId;
    let siteKey;

    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at)
           VALUES (?, ?, ?, 0, 0, ?)`,
        )
        .run(username, passwordHash, role, now);
      userId = Number(info.lastInsertRowid);

      siteKey = generateUniqueSiteKey(db);
      db.prepare(
        `INSERT INTO sites (owner_id, name, site_key, allowed_origins, rate_limit_per_min, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        DEFAULT_SITE_NAME,
        siteKey,
        JSON.stringify(origins),
        DEFAULT_SITE_RATE_LIMIT,
        now,
      );
    })();

    appendCredentials(fd, username, password);
    console.log(`Added user ${username} (id ${userId}, role ${role}).`);
    console.log(`Site key: ${siteKey}`);
  } finally {
    fs.closeSync(fd);
  }
}

function resetPassword(db, args, options) {
  requireArgs(args, 1, 'reset-password <username> --out FILE');
  const user = findUser(db, args[0]);
  const fd = openCredentialsFile(options.out);
  try {
    const password = generatePassword();
    const passwordHash = hashPassword(password);

    db.transaction(() => {
      db.prepare(
        'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
      ).run(passwordHash, user.id);
    })();

    appendCredentials(fd, user.username, password);
    console.log(`Reset password for ${user.username}.`);
  } finally {
    fs.closeSync(fd);
  }
}

function setDisabled(db, args, disabled) {
  requireArgs(args, 1, `${disabled ? 'disable' : 'enable'} <username>`);
  const user = findUser(db, args[0]);

  if (disabled) {
    db.prepare(
      'UPDATE users SET disabled = 1, session_version = session_version + 1 WHERE id = ?',
    ).run(user.id);
    console.log(`Disabled ${user.username}.`);
  } else {
    db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(user.id);
    console.log(`Enabled ${user.username}.`);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usageText());
    return;
  }

  const [command, ...args] = parsed.positionals;
  if (!command) {
    console.error(usageText());
    process.exit(1);
  }

  const Database = await loadDatabase();
  const dbPath = parsed.options.db || process.env.SHOPPULSE_DB_PATH || '';
  if (!dbPath) fail('no database specified: pass --db PATH or set SHOPPULSE_DB_PATH');

  const db = openDatabase(Database, dbPath);
  try {
    switch (command) {
      case 'list':
        listUsers(db, args);
        break;
      case 'add':
        addUser(db, args, parsed.options);
        break;
      case 'reset-password':
        resetPassword(db, args, parsed.options);
        break;
      case 'disable':
        setDisabled(db, args, true);
        break;
      case 'enable':
        setDisabled(db, args, false);
        break;
      default:
        fail(`unknown command: ${command} (try --help)`);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
