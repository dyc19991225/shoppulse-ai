import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getUserById,
  openDb,
  V1_SCHEMA_SQL,
  type DB,
} from '@/lib/db';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = '2024-01-01T00:00:00.000Z';

/**
 * Builds a populated schema-v1 database exactly as the previous release left
 * it, so the test exercises the real upgrade path (not a fresh v2 install).
 */
function createPopulatedV1(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-mig-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'v1.db');

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(V1_SCHEMA_SQL);
  db.pragma('user_version = 1');

  db.prepare(
    `INSERT INTO sites (id, name, site_key, allowed_origins, rate_limit_per_min, created_at)
     VALUES (5, '老站点', 'legacy-site-key', '["https://old.example.com"]', 30, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO kb_entries (id, type, title, content, keywords, enabled, created_at, updated_at)
     VALUES (20, 'policy', '退货政策', '7 天无理由退货', '退货', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO products
       (id, sku, name, category, price, stock, description, selling_points,
        image_url, url, enabled, created_at, updated_at)
     VALUES (10, 'SKU-1', '商品一', '分类', 9.9, 5, '', '', '', '', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO products
       (id, sku, name, category, price, stock, description, selling_points,
        image_url, url, enabled, created_at, updated_at)
     VALUES (11, 'SKU-2', '商品二', '', 19.9, 0, '', '', '', '', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, started_at, last_at, needs_human, handled, top_intent)
     VALUES ('conv-legacy', 5, 'v1', ?, ?, 0, 0, 'price')`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, intent, created_at)
     VALUES ('msg-legacy', 'conv-legacy', 'user', '多少钱', 'price', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO copy_history (id, product_id, params, outputs, created_at)
     VALUES ('copy-legacy', 11, '{}', '{}', ?)`,
  ).run(NOW);

  db.close();
  return dbPath;
}

function count(db: DB, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

describe('schema v1 -> v2 migration', () => {
  it('upgrades a populated v1 database in place', () => {
    const db = openDb({ dbPath: createPopulatedV1(), seedDefaultSite: false });

    expect(db.pragma('user_version', { simple: true })).toBe(2);
    // Foreign key enforcement is restored and the rebuild left nothing broken.
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);

    expect(getUserById(db, 1)).toMatchObject({
      id: 1,
      username: 'admin',
      role: 'admin',
      disabled: false,
      sessionVersion: 0,
    });
    expect(getUserById(db, 1)!.passwordHash).toBe('');

    // Every pre-existing row belongs to the bootstrap admin, ids preserved.
    expect(count(db, 'SELECT COUNT(*) AS count FROM kb_entries WHERE owner_id = 1')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS count FROM products WHERE owner_id = 1')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) AS count FROM sites WHERE owner_id = 1')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS count FROM copy_history WHERE owner_id = 1')).toBe(1);

    const products = db
      .prepare('SELECT id, sku, name FROM products ORDER BY id')
      .all() as { id: number; sku: string; name: string }[];
    expect(products).toEqual([
      { id: 10, sku: 'SKU-1', name: '商品一' },
      { id: 11, sku: 'SKU-2', name: '商品二' },
    ]);

    const kb = db.prepare('SELECT id, owner_id, title FROM kb_entries').get() as {
      id: number;
      owner_id: number;
      title: string;
    };
    expect(kb).toEqual({ id: 20, owner_id: 1, title: '退货政策' });

    const site = db.prepare('SELECT id, owner_id, site_key FROM sites').get() as {
      id: number;
      owner_id: number;
      site_key: string;
    };
    expect(site).toEqual({ id: 5, owner_id: 1, site_key: 'legacy-site-key' });

    // copy_history still points at the same product row after the rebuild.
    const copy = db
      .prepare('SELECT id, owner_id, product_id FROM copy_history')
      .get() as { id: string; owner_id: number; product_id: number };
    expect(copy).toEqual({ id: 'copy-legacy', owner_id: 1, product_id: 11 });

    // Conversations keep their site link (owner is derived through sites).
    const conversation = db
      .prepare('SELECT id, site_id FROM conversations')
      .get() as { id: string; site_id: number };
    expect(conversation).toEqual({ id: 'conv-legacy', site_id: 5 });
    expect(count(db, 'SELECT COUNT(*) AS count FROM messages')).toBe(1);

    // AUTOINCREMENT continues after the highest preserved id.
    const info = db
      .prepare(
        `INSERT INTO products (owner_id, name, created_at, updated_at)
         VALUES (1, '新商品', ?, ?)`,
      )
      .run(NOW, NOW);
    expect(Number(info.lastInsertRowid)).toBe(12);

    db.close();
  });

  it('enforces SKU uniqueness per owner, not globally', () => {
    const db = openDb({ dbPath: createPopulatedV1(), seedDefaultSite: false });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
       VALUES (2, 'friend', '', 'user', 0, 0, ?)`,
    ).run(NOW);

    // Same SKU as user 1's SKU-1 is fine for another owner.
    expect(() =>
      db
        .prepare(
          `INSERT INTO products (owner_id, sku, name, created_at, updated_at)
           VALUES (2, 'SKU-1', '别人的商品', ?, ?)`,
        )
        .run(NOW, NOW),
    ).not.toThrow();

    // Duplicate within one owner is still rejected.
    expect(() =>
      db
        .prepare(
          `INSERT INTO products (owner_id, sku, name, created_at, updated_at)
           VALUES (1, 'SKU-1', '重复 SKU', ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/UNIQUE constraint failed/);

    db.close();
  });

  it('keeps copy_history pointing at the rebuilt products table', () => {
    const db = openDb({ dbPath: createPopulatedV1(), seedDefaultSite: false });

    // The rebuild creates products_v2, drops products and renames the new
    // table. The FK must follow the rename to 'products', not keep a stale
    // reference to a table that no longer exists.
    const productFk = (
      db.pragma('foreign_key_list(copy_history)') as {
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }[]
    ).find((fk) => fk.from === 'product_id');
    expect(productFk).toMatchObject({
      table: 'products',
      to: 'id',
      on_delete: 'SET NULL',
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);

    db.close();
  });

  it('keeps copy_history ON DELETE SET NULL working after the products rebuild', () => {
    const db = openDb({ dbPath: createPopulatedV1(), seedDefaultSite: false });

    db.prepare('DELETE FROM products WHERE id = ?').run(11);
    const copy = db
      .prepare('SELECT product_id FROM copy_history WHERE id = ?')
      .get('copy-legacy') as { product_id: number | null };
    expect(copy.product_id).toBeNull();

    db.close();
  });

  it('adds owner indexes for every owned table', () => {
    const db = openDb({ dbPath: createPopulatedV1(), seedDefaultSite: false });
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);

    for (const index of [
      'idx_kb_owner',
      'idx_products_owner',
      'idx_copy_history_owner',
      'idx_sites_owner',
    ]) {
      expect(indexes, index).toContain(index);
    }

    db.close();
  });

  it('is a no-op when re-opened on an already migrated database', () => {
    const dbPath = createPopulatedV1();
    const first = openDb({ dbPath, seedDefaultSite: false });
    first.close();

    const second = openDb({ dbPath, seedDefaultSite: false });
    expect(second.pragma('user_version', { simple: true })).toBe(2);
    expect(count(second, 'SELECT COUNT(*) AS count FROM users')).toBe(1);
    expect(count(second, 'SELECT COUNT(*) AS count FROM products')).toBe(2);
    second.close();
  });
});
