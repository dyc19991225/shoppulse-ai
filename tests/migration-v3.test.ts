import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, V2_SCHEMA_SQL, type DB } from '@/lib/db';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = '2024-01-01T00:00:00.000Z';

/** A populated schema-v2 database, as the previous release left it. */
function createPopulatedV2(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-mig3-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'v2.db');

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(V2_SCHEMA_SQL);
  db.pragma('user_version = 2');

  // V2_SCHEMA_SQL already inserts the bootstrap admin (id 1).
  db.prepare(
    `INSERT INTO sites (id, owner_id, name, site_key, allowed_origins, rate_limit_per_min, created_at)
     VALUES (7, 1, '老站点', 'legacy-v2-key', '[]', 30, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, started_at, last_at, needs_human, handled, top_intent)
     VALUES ('conv-v2', 7, 'v1', ?, ?, 1, 0, 'price')`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, intent, created_at)
     VALUES ('msg-v2', 'conv-v2', 'user', '多少钱', 'price', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO kb_entries (id, owner_id, type, title, content, keywords, enabled, created_at, updated_at)
     VALUES (3, 1, 'faq', '退货', '7 天', '', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.close();
  return dbPath;
}

function count(db: DB, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

describe('schema v2 -> v3 migration', () => {
  it('adds quick replies and the workspace columns, preserving existing data', () => {
    const db = openDb({ dbPath: createPopulatedV2(), seedDefaultSite: false });

    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);

    // Existing rows survive untouched.
    expect(count(db, 'SELECT COUNT(*) AS count FROM users')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS count FROM conversations')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS count FROM messages')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS count FROM kb_entries')).toBe(1);

    // New columns arrive with their defaults, ready for F3 / F5.
    const conversation = db
      .prepare('SELECT tags, note, site_id FROM conversations WHERE id = ?')
      .get('conv-v2') as { tags: string; note: string; site_id: number };
    expect(conversation).toEqual({ tags: '[]', note: '', site_id: 7 });
    const site = db
      .prepare('SELECT welcome_message, owner_id FROM sites WHERE id = ?')
      .get(7) as { welcome_message: string; owner_id: number };
    expect(site).toEqual({ welcome_message: '', owner_id: 1 });

    // quick_replies exists, accepts rows and is indexed by owner.
    const info = db
      .prepare(
        `INSERT INTO quick_replies (owner_id, title, content, created_at, updated_at)
         VALUES (1, '问候', '您好', ?, ?)`,
      )
      .run(NOW, NOW);
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain('idx_quick_replies_owner');

    // The owner FK is enforced.
    expect(() =>
      db
        .prepare(
          `INSERT INTO quick_replies (owner_id, title, content, created_at, updated_at)
           VALUES (99, 'x', 'y', ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it('is a no-op when re-opened', () => {
    const dbPath = createPopulatedV2();
    openDb({ dbPath, seedDefaultSite: false }).close();

    const second = openDb({ dbPath, seedDefaultSite: false });
    expect(second.pragma('user_version', { simple: true })).toBe(3);
    expect(count(second, 'SELECT COUNT(*) AS count FROM quick_replies')).toBe(0);
    expect(count(second, 'SELECT COUNT(*) AS count FROM conversations')).toBe(1);
    second.close();
  });
});
