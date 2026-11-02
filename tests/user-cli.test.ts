import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@/lib/auth/password';
import { verifyUserCredentials } from '@/lib/auth';
import { V1_SCHEMA_SQL } from '@/lib/db';
import { createTempDb, type TempDb } from './helpers/tempdb';

/**
 * Behavioural tests for deploy/user.mjs: the script is spawned as a real Node
 * process against a migrated temp database, exactly as it runs inside a release.
 * It must not need the TypeScript source or tsx.
 */

const SCRIPT = path.resolve(__dirname, '..', 'deploy', 'user.mjs');

/** DB-only config: generated users authenticate from their stored hash. */
const CONFIG = { admin: { username: 'admin', passwordHash: '', password: '' } };

const tempDbs: TempDb[] = [];
const tempDirs: string[] = [];

function tempDb(): TempDb {
  const temp = createTempDb({ seedDefaultSite: false });
  tempDbs.push(temp);
  return temp;
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-usercli-'));
  tempDirs.push(dir);
  return dir;
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): CliResult {
  const cleanEnv = { ...process.env };
  delete cleanEnv.SHOPPULSE_DB_PATH;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...cleanEnv, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runOk(args: string[], env: Record<string, string> = {}): CliResult {
  const result = run(args, env);
  expect(result.status, result.stderr).toBe(0);
  return result;
}

/** Reads "username<TAB>password" lines from a credentials file. */
function credentials(file: string): { username: string; password: string }[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [username, password] = line.split('\t');
      return { username, password };
    });
}

function userRow(db: Database.Database, username: string) {
  return db
    .prepare(
      'SELECT id, username, password_hash, role, disabled, session_version FROM users WHERE username = ?',
    )
    .get(username) as
    | {
        id: number;
        username: string;
        password_hash: string;
        role: string;
        disabled: number;
        session_version: number;
      }
    | undefined;
}

function siteRows(db: Database.Database, ownerId: number) {
  return db
    .prepare('SELECT * FROM sites WHERE owner_id = ? ORDER BY id')
    .all(ownerId) as {
    id: number;
    owner_id: number;
    name: string;
    site_key: string;
    allowed_origins: string;
    rate_limit_per_min: number;
  }[];
}

function expectNoSecret(result: CliResult, password: string): void {
  expect(result.stdout).not.toContain(password);
  expect(result.stderr).not.toContain(password);
}

afterEach(() => {
  for (const temp of tempDbs.splice(0)) temp.cleanup();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('deploy/user.mjs add', () => {
  it('creates a user and default site, and writes the password only to a 0600 file', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'trial-accounts.txt');

    const result = runOk(['add', 'trial1', '--db', temp.path, '--out', out]);

    const [entry] = credentials(out);
    expect(entry.username).toBe('trial1');
    // >= 20 URL-safe chars from crypto.randomBytes.
    expect(entry.password).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    expectNoSecret(result, entry.password);
    // Only the non-secret site key is printed.
    expect(result.stdout).toContain('Added user trial1');
    expect(result.stdout).toMatch(/Site key: [0-9a-f]{14}/);

    // Credentials file: owner-only, exactly one line.
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(out, 'utf8').trim().split('\n')).toHaveLength(1);

    // The stored hash is scrypt and verifies the generated password through the
    // same verifier the login route uses.
    const user = userRow(temp.db, 'trial1')!;
    expect(user.role).toBe('user');
    expect(user.disabled).toBe(0);
    expect(user.session_version).toBe(0);
    expect(user.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPassword(entry.password, user.password_hash)).toBe(true);
    expect(verifyUserCredentials(temp.db, 'trial1', entry.password, CONFIG)).toMatchObject({
      ok: true,
      user: { id: user.id, username: 'trial1' },
    });
    // Usernames are looked up case-insensitively.
    expect(verifyUserCredentials(temp.db, 'TRIAL1', entry.password, CONFIG).ok).toBe(true);
    expect(verifyUserCredentials(temp.db, 'trial1', 'wrong-password', CONFIG).ok).toBe(false);

    // One default site owned by the new user, ready for the widget.
    const sites = siteRows(temp.db, user.id);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      owner_id: user.id,
      name: '默认站点',
      rate_limit_per_min: 30,
      allowed_origins: '[]',
    });
    expect(sites[0].site_key).toMatch(/^[0-9a-f]{14}$/);
    expect(sites[0].site_key).toBe(result.stdout.match(/Site key: ([0-9a-f]{14})/)![1]);

    // The bootstrap admin's data is untouched.
    expect(siteRows(temp.db, 1)).toHaveLength(0);
  });

  it('accepts --role admin and --site-origin, normalizing origins', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');

    runOk([
      'add',
      'boss',
      '--db',
      temp.path,
      '--out',
      out,
      '--role',
      'admin',
      '--site-origin',
      'https://Shop.Example.com/',
      '--site-origin',
      'http://localhost:3000',
    ]);

    const user = userRow(temp.db, 'boss')!;
    expect(user.role).toBe('admin');
    const [site] = siteRows(temp.db, user.id);
    expect(JSON.parse(site.allowed_origins)).toEqual([
      'https://shop.example.com',
      'http://localhost:3000',
    ]);
    expect(site.rate_limit_per_min).toBe(30);
  });

  it('appends to an existing credentials file and forces mode 0600', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');
    fs.writeFileSync(out, 'existing\tsecret\n', { mode: 0o644 });
    fs.chmodSync(out, 0o644);

    runOk(['add', 'trial1', '--db', temp.path, '--out', out]);
    runOk(['add', 'trial2', '--db', temp.path, '--out', out]);

    expect(credentials(out).map((row) => row.username)).toEqual([
      'existing',
      'trial1',
      'trial2',
    ]);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    expect(userRow(temp.db, 'trial1')).toBeDefined();
    expect(userRow(temp.db, 'trial2')).toBeDefined();
  });

  it('refuses without --out and creates nothing', () => {
    const temp = tempDb();

    const result = run(['add', 'trial1', '--db', temp.path]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--out');
    expect(userRow(temp.db, 'trial1')).toBeUndefined();
    expect(temp.db.prepare('SELECT COUNT(*) AS count FROM sites').get()).toEqual({ count: 0 });
  });

  it('rejects invalid usernames, duplicate users and bad options', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');

    for (const username of ['Trial1', 'a', '1'.repeat(33), 'trial/1']) {
      const result = run(['add', username, '--db', temp.path, '--out', out]);
      expect(result.status, username).not.toBe(0);
      expect(result.stderr).toContain('username must be');
    }

    runOk(['add', 'trial1', '--db', temp.path, '--out', out]);
    // Usernames are lowercase by format and unique case-insensitively (COLLATE
    // NOCASE), so a row written with different casing still blocks the name.
    temp.db
      .prepare(
        `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at)
         VALUES ('LegacyCase', '', 'user', 0, 0, ?)`,
      )
      .run(new Date().toISOString());
    for (const username of ['trial1', 'legacycase']) {
      const duplicate = run(['add', username, '--db', temp.path, '--out', out]);
      expect(duplicate.status, username).not.toBe(0);
      expect(duplicate.stderr).toContain('already exists');
    }

    const badRole = run(['add', 'other', '--db', temp.path, '--out', out, '--role', 'root']);
    expect(badRole.status).not.toBe(0);
    expect(badRole.stderr).toContain('--role');

    const badOrigin = run([
      'add',
      'other',
      '--db',
      temp.path,
      '--out',
      out,
      '--site-origin',
      'https://shop.example.com/path',
    ]);
    expect(badOrigin.status).not.toBe(0);
    expect(badOrigin.stderr).toContain('--site-origin');
  });
});

describe('deploy/user.mjs reset-password, disable and enable', () => {
  it('resets the password, appends it to the file and bumps session_version', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');
    runOk(['add', 'trial1', '--db', temp.path, '--out', out]);
    const first = credentials(out)[0];

    const result = runOk(['reset-password', 'trial1', '--db', temp.path, '--out', out]);

    const rows = credentials(out);
    expect(rows).toHaveLength(2);
    expect(rows[1].username).toBe('trial1');
    expect(rows[1].password).not.toBe(first.password);
    expectNoSecret(result, rows[1].password);

    const user = userRow(temp.db, 'trial1')!;
    expect(user.session_version).toBe(1);
    expect(verifyPassword(rows[1].password, user.password_hash)).toBe(true);
    expect(verifyUserCredentials(temp.db, 'trial1', rows[1].password, CONFIG).ok).toBe(true);
    expect(verifyUserCredentials(temp.db, 'trial1', first.password, CONFIG).ok).toBe(false);
    // The default site is not recreated.
    expect(siteRows(temp.db, user.id)).toHaveLength(1);

    const missingOut = run(['reset-password', 'trial1', '--db', temp.path]);
    expect(missingOut.status).not.toBe(0);
    expect(missingOut.stderr).toContain('--out');

    const unknown = run(['reset-password', 'nobody', '--db', temp.path, '--out', out]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('user not found');
  });

  it('disable signs the user out and rejects login; enable allows login again', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');
    runOk(['add', 'trial1', '--db', temp.path, '--out', out]);
    const { password } = credentials(out)[0];

    expect(verifyUserCredentials(temp.db, 'trial1', password, CONFIG).ok).toBe(true);

    const disabled = runOk(['disable', 'trial1', '--db', temp.path]);
    expect(disabled.stdout).toContain('Disabled trial1');
    let user = userRow(temp.db, 'trial1')!;
    expect(user.disabled).toBe(1);
    expect(user.session_version).toBe(1);
    expect(verifyUserCredentials(temp.db, 'trial1', password, CONFIG).ok).toBe(false);

    const enabled = runOk(['enable', 'trial1', '--db', temp.path]);
    expect(enabled.stdout).toContain('Enabled trial1');
    user = userRow(temp.db, 'trial1')!;
    expect(user.disabled).toBe(0);
    // Enable does not issue new sessions; disable's bump already killed them.
    expect(user.session_version).toBe(1);
    expect(verifyUserCredentials(temp.db, 'trial1', password, CONFIG).ok).toBe(true);

    const unknown = run(['enable', 'nobody', '--db', temp.path]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('user not found');
  });
});

describe('deploy/user.mjs list and guards', () => {
  it('lists users without password hashes', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');
    runOk(['add', 'trial1', '--db', temp.path, '--out', out]);

    const result = runOk(['list', '--db', temp.path]);
    const lines = result.stdout.trim().split('\n');

    expect(lines[0]).toBe('id\tusername\trole\tdisabled\tcreated_at');
    expect(lines[1]).toMatch(/^1\tadmin\tadmin\t0\t/);
    expect(lines[2]).toMatch(/^2\ttrial1\tuser\t0\t/);
    // No scrypt hashes (or the generated password) on stdout/stderr.
    expect(result.stdout).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{64}/);
    expect(result.stderr).toBe('');
    expectNoSecret(result, credentials(out)[0].password);
  });

  it('uses SHOPPULSE_DB_PATH when --db is omitted', () => {
    const temp = tempDb();
    const out = path.join(tempDir(), 'accounts.txt');

    runOk(['add', 'trial1', '--out', out], { SHOPPULSE_DB_PATH: temp.path });

    expect(userRow(temp.db, 'trial1')).toBeDefined();
  });

  it('refuses a database that has not been migrated to v2', () => {
    const dir = tempDir();
    const v1Path = path.join(dir, 'v1.db');
    const raw = new Database(v1Path);
    raw.exec(V1_SCHEMA_SQL);
    raw.pragma('user_version = 1');
    raw.close();

    for (const args of [['list'], ['add', 'trial1', '--out', path.join(dir, 'out.txt')]]) {
      const result = run([...args, '--db', v1Path]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('v2 is required');
      expect(result.stderr).toContain('start the service once to migrate');
    }
    // Still schema v1: the CLI never migrated anything itself.
    const check = new Database(v1Path, { readonly: true });
    expect(check.pragma('user_version', { simple: true })).toBe(1);
    check.close();
  });

  it('fails clearly for missing databases and unknown commands', () => {
    const dir = tempDir();
    const missing = run(['list', '--db', path.join(dir, 'nope.db')]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('cannot open database');

    const temp = tempDb();
    const unknown = run(['promote', 'trial1', '--db', temp.path]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('unknown command');
  });
});
