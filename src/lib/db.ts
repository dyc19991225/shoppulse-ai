import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AppConfig } from './config';

export type DB = Database.Database;
type Row = Record<string, unknown>;

/** v1 schema. Exported so migration tests can build a pre-upgrade database. */
export const V1_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS kb_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'faq',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    selling_points TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    site_key TEXT NOT NULL UNIQUE,
    allowed_origins TEXT NOT NULL DEFAULT '[]',
    rate_limit_per_min INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id),
    visitor_id TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    needs_human INTEGER NOT NULL DEFAULT 0,
    handled INTEGER NOT NULL DEFAULT 0,
    top_intent TEXT NOT NULL DEFAULT 'other'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    intent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS copy_history (
    id TEXT PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    params TEXT NOT NULL,
    outputs TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_kb_enabled ON kb_entries(enabled);
  CREATE INDEX IF NOT EXISTS idx_products_enabled ON products(enabled);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conversations_site ON conversations(site_id, started_at);
`;

/**
 * v2 adds users and per-owner scoping. Existing rows belong to user 1 (the
 * bootstrap admin). products is rebuilt because SQLite cannot drop the old
 * global UNIQUE(sku) constraint; foreign keys are disabled around the rebuild
 * so copy_history rows keep pointing at the same product ids.
 */
const MIGRATION_V2_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('admin','user')) DEFAULT 'user',
    disabled INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  INSERT INTO users (id, username, password_hash, role, disabled, session_version, created_at)
  VALUES (1, 'admin', '', 'admin', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

  ALTER TABLE kb_entries ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
  ALTER TABLE copy_history ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
  ALTER TABLE sites ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);

  CREATE TABLE products_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    sku TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    selling_points TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, sku)
  );
  INSERT INTO products_v2
    (id, owner_id, sku, name, category, price, stock, description, selling_points,
     image_url, url, enabled, created_at, updated_at)
  SELECT id, 1, sku, name, category, price, stock, description, selling_points,
         image_url, url, enabled, created_at, updated_at
  FROM products;
  DROP TABLE products;
  ALTER TABLE products_v2 RENAME TO products;

  CREATE INDEX idx_kb_owner ON kb_entries(owner_id);
  CREATE INDEX idx_products_owner ON products(owner_id);
  CREATE INDEX idx_products_enabled ON products(enabled);
  CREATE INDEX idx_copy_history_owner ON copy_history(owner_id);
  CREATE INDEX idx_sites_owner ON sites(owner_id);
`;

const MIGRATIONS: string[] = [V1_SCHEMA_SQL, MIGRATION_V2_SQL];

export interface OpenDbOptions {
  /** SQLite path; `:memory:` is supported. Defaults to env SHOPPULSE_DB_PATH. */
  dbPath?: string;
  /** Skip default-site seeding (tests usually want deterministic state). */
  seedDefaultSite?: boolean;
}

/**
 * Opens (and migrates) a SQLite database. WAL mode for concurrent reads.
 * Use `:memory:` or a temp file in tests.
 */
export function openDb(dbPathOrOptions: string | OpenDbOptions = {}): DB {
  const opts: OpenDbOptions =
    typeof dbPathOrOptions === 'string' ? { dbPath: dbPathOrOptions } : dbPathOrOptions;
  const dbPath = opts.dbPath ?? process.env.SHOPPULSE_DB_PATH ?? './data/shoppulse.db';

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  if (opts.seedDefaultSite !== false) {
    ensureDefaultSite(db);
  }

  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= MIGRATIONS.length) return;

  // SQLite refuses a REFERENCES column with a non-NULL default while foreign
  // keys are enforced, and dropping/renaming the referenced products table
  // would fire ON DELETE SET NULL on copy_history. Both must be done with
  // enforcement off; integrity is checked before turning it back on.
  const enforceForeignKeys = db.pragma('foreign_keys', { simple: true }) === 1;
  if (enforceForeignKeys) db.pragma('foreign_keys = OFF');

  try {
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      const run = db.transaction(() => {
        db.exec(MIGRATIONS[version]);
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(`Migration v${version + 1} left foreign key violations`);
        }
        db.pragma(`user_version = ${version + 1}`);
      });
      run();
    }
  } finally {
    if (enforceForeignKeys) db.pragma('foreign_keys = ON');
  }
}

export const DEFAULT_SITE_NAME = '默认站点';
export const DEFAULT_SITE_KEY = 'demo-site-key';
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Id of the bootstrap admin created by migration v2; it owns all v1 data. */
export const BOOTSTRAP_ADMIN_ID = 1;

/** Creates the bootstrap admin's default widget site on first boot if none exist. */
export function ensureDefaultSite(db: DB): number {
  const existing = db
    .prepare('SELECT id FROM sites ORDER BY id LIMIT 1')
    .get() as { id: number } | undefined;
  if (existing) return existing.id;

  const info = db
    .prepare(
      `INSERT INTO sites (owner_id, name, site_key, allowed_origins, rate_limit_per_min, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      BOOTSTRAP_ADMIN_ID,
      DEFAULT_SITE_NAME,
      DEFAULT_SITE_KEY,
      JSON.stringify(DEFAULT_ALLOWED_ORIGINS),
      30,
      nowIso(),
    );
  return Number(info.lastInsertRowid);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Users repository (schema v2)
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'user';

/** Public user shape; password hashes never leave the repository layer. */
export interface User {
  id: number;
  username: string;
  role: UserRole;
  disabled: boolean;
  sessionVersion: number;
  createdAt: string;
}

export interface UserWithPassword extends User {
  /** scrypt `salt:hash`; '' when only the env admin hash applies. */
  passwordHash: string;
}

function mapUser(row: Row): UserWithPassword {
  return {
    id: Number(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    role: row.role === 'admin' ? 'admin' : 'user',
    disabled: bool(row.disabled),
    sessionVersion: Number(row.session_version),
    createdAt: String(row.created_at),
  };
}

/** Looks a user up by username, case-insensitively. */
export function getUserByUsername(db: DB, username: string): UserWithPassword | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as Row | undefined;
  return row ? mapUser(row) : null;
}

export function getUserById(db: DB, id: number): UserWithPassword | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return row ? mapUser(row) : null;
}

/**
 * Keeps user 1 (the bootstrap admin, owner of all pre-v2 data) aligned with
 * the env admin so existing deployments keep the same login name. Renames only
 * while user 1 has no password of its own, and never takes a username another
 * account already uses. The env hash is never copied: login reads it live, so
 * rotating ADMIN_PASSWORD_HASH keeps working.
 */
export function ensureEnvAdmin(
  db: DB,
  config: Pick<AppConfig, 'admin'>,
): UserWithPassword | null {
  const username = config.admin.username.trim();
  const admin = getUserById(db, BOOTSTRAP_ADMIN_ID);
  if (!admin || !username || admin.username === username) return admin;
  if (admin.passwordHash !== '') return admin;
  if (getUserByUsername(db, username)) return admin;

  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, BOOTSTRAP_ADMIN_ID);
  return getUserById(db, BOOTSTRAP_ADMIN_ID);
}

// ---------------------------------------------------------------------------
// Row shapes (snake_case) and public domain shapes (camelCase)
// ---------------------------------------------------------------------------

export type KbType = 'faq' | 'policy' | 'shop_info' | 'other';
export const KB_TYPES: readonly KbType[] = ['faq', 'policy', 'shop_info', 'other'];

export interface KbEntry {
  id: number;
  type: KbType;
  title: string;
  content: string;
  keywords: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KbInput {
  type?: KbType;
  title: string;
  content: string;
  keywords?: string;
  enabled?: boolean;
}

export interface Product {
  id: number;
  sku: string | null;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
  sellingPoints: string;
  imageUrl: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  sku?: string | null;
  name: string;
  category?: string;
  price?: number;
  stock?: number;
  description?: string;
  sellingPoints?: string;
  imageUrl?: string;
  url?: string;
  enabled?: boolean;
}

export interface Site {
  id: number;
  ownerId: number;
  name: string;
  siteKey: string;
  allowedOrigins: string[];
  rateLimitPerMin: number;
  createdAt: string;
}

export interface SiteInput {
  name: string;
  siteKey: string;
  allowedOrigins: string[];
  rateLimitPerMin: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  siteId: number;
  visitorId: string;
  startedAt: string;
  lastAt: string;
  needsHuman: boolean;
  handled: boolean;
  topIntent: string;
}

export interface ConversationSummary extends Conversation {
  siteName: string;
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  intent: string;
  createdAt: string;
}

export interface CopyHistoryEntry {
  id: string;
  productId: number | null;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function mapKb(row: Row): KbEntry {
  return {
    id: Number(row.id),
    type: row.type as KbType,
    title: String(row.title),
    content: String(row.content),
    keywords: String(row.keywords),
    enabled: bool(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProduct(row: Row): Product {
  return {
    id: Number(row.id),
    sku: row.sku === null || row.sku === undefined ? null : String(row.sku),
    name: String(row.name),
    category: String(row.category),
    price: Number(row.price),
    stock: Number(row.stock),
    description: String(row.description),
    sellingPoints: String(row.selling_points),
    imageUrl: String(row.image_url),
    url: String(row.url),
    enabled: bool(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSite(row: Row): Site {
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    name: String(row.name),
    siteKey: String(row.site_key),
    allowedOrigins: parseJson<string[]>(String(row.allowed_origins), []),
    rateLimitPerMin: Number(row.rate_limit_per_min),
    createdAt: String(row.created_at),
  };
}

function mapConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    siteId: Number(row.site_id),
    visitorId: String(row.visitor_id),
    startedAt: String(row.started_at),
    lastAt: String(row.last_at),
    needsHuman: bool(row.needs_human),
    handled: bool(row.handled),
    topIntent: String(row.top_intent),
  };
}

function mapMessage(row: Row): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role as MessageRole,
    content: String(row.content),
    intent: String(row.intent),
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Knowledge base repository
// ---------------------------------------------------------------------------

export interface KbListOptions {
  search?: string;
  enabledOnly?: boolean;
  limit?: number;
}

export function listKbEntries(
  db: DB,
  ownerId: number,
  options: KbListOptions = {},
): KbEntry[] {
  const where: string[] = ['owner_id = ?'];
  const params: unknown[] = [ownerId];
  if (options.enabledOnly) where.push('enabled = 1');
  if (options.search?.trim()) {
    const like = `%${options.search.trim()}%`;
    where.push('(title LIKE ? OR content LIKE ? OR keywords LIKE ?)');
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM kb_entries WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC, id DESC ${options.limit ? 'LIMIT ?' : ''}`;
  if (options.limit) params.push(options.limit);
  return (db.prepare(sql).all(...params) as Row[]).map(mapKb);
}

export function getKbEntry(db: DB, ownerId: number, id: number): KbEntry | null {
  const row = db
    .prepare('SELECT * FROM kb_entries WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? mapKb(row) : null;
}

export function createKbEntry(db: DB, ownerId: number, input: KbInput): KbEntry {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO kb_entries (owner_id, type, title, content, keywords, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ownerId,
      input.type ?? 'faq',
      input.title,
      input.content,
      input.keywords ?? '',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return getKbEntry(db, ownerId, Number(info.lastInsertRowid))!;
}

export function updateKbEntry(
  db: DB,
  ownerId: number,
  id: number,
  input: Partial<KbInput>,
): KbEntry | null {
  const existing = getKbEntry(db, ownerId, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE kb_entries
     SET type = ?, title = ?, content = ?, keywords = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    merged.type,
    merged.title,
    merged.content,
    merged.keywords,
    merged.enabled ? 1 : 0,
    nowIso(),
    id,
    ownerId,
  );
  return getKbEntry(db, ownerId, id);
}

export function deleteKbEntry(db: DB, ownerId: number, id: number): boolean {
  return (
    db.prepare('DELETE FROM kb_entries WHERE id = ? AND owner_id = ?').run(id, ownerId).changes >
    0
  );
}

// ---------------------------------------------------------------------------
// Products repository
// ---------------------------------------------------------------------------

export interface ProductListOptions {
  search?: string;
  category?: string;
  enabledOnly?: boolean;
  limit?: number;
}

export function listProducts(
  db: DB,
  ownerId: number,
  options: ProductListOptions = {},
): Product[] {
  const where: string[] = ['owner_id = ?'];
  const params: unknown[] = [ownerId];
  if (options.enabledOnly) where.push('enabled = 1');
  if (options.category?.trim()) {
    where.push('category = ?');
    params.push(options.category.trim());
  }
  if (options.search?.trim()) {
    const like = `%${options.search.trim()}%`;
    where.push('(name LIKE ? OR sku LIKE ? OR category LIKE ? OR description LIKE ?)');
    params.push(like, like, like, like);
  }
  const sql = `SELECT * FROM products WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC, id DESC ${options.limit ? 'LIMIT ?' : ''}`;
  if (options.limit) params.push(options.limit);
  return (db.prepare(sql).all(...params) as Row[]).map(mapProduct);
}

export function getProduct(db: DB, ownerId: number, id: number): Product | null {
  const row = db
    .prepare('SELECT * FROM products WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? mapProduct(row) : null;
}

export function getProductBySku(db: DB, ownerId: number, sku: string): Product | null {
  const row = db
    .prepare('SELECT * FROM products WHERE sku = ? AND owner_id = ?')
    .get(sku, ownerId) as Record<string, unknown> | undefined;
  return row ? mapProduct(row) : null;
}

export function createProduct(db: DB, ownerId: number, input: ProductInput): Product {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO products
       (owner_id, sku, name, category, price, stock, description, selling_points, image_url, url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ownerId,
      input.sku?.trim() || null,
      input.name,
      input.category ?? '',
      input.price ?? 0,
      input.stock ?? 0,
      input.description ?? '',
      input.sellingPoints ?? '',
      input.imageUrl ?? '',
      input.url ?? '',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return getProduct(db, ownerId, Number(info.lastInsertRowid))!;
}

export function updateProduct(
  db: DB,
  ownerId: number,
  id: number,
  input: Partial<ProductInput>,
): Product | null {
  const existing = getProduct(db, ownerId, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE products
     SET sku = ?, name = ?, category = ?, price = ?, stock = ?, description = ?,
         selling_points = ?, image_url = ?, url = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    merged.sku?.trim() || null,
    merged.name,
    merged.category,
    merged.price,
    merged.stock,
    merged.description,
    merged.sellingPoints,
    merged.imageUrl,
    merged.url,
    merged.enabled ? 1 : 0,
    nowIso(),
    id,
    ownerId,
  );
  return getProduct(db, ownerId, id);
}

export function deleteProduct(db: DB, ownerId: number, id: number): boolean {
  return (
    db.prepare('DELETE FROM products WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0
  );
}

// ---------------------------------------------------------------------------
// Sites repository
// ---------------------------------------------------------------------------

export function listSites(db: DB, ownerId: number): Site[] {
  return (
    db.prepare('SELECT * FROM sites WHERE owner_id = ? ORDER BY id ASC').all(ownerId) as Row[]
  ).map(mapSite);
}

export function getSiteById(db: DB, ownerId: number, id: number): Site | null {
  const row = db
    .prepare('SELECT * FROM sites WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? mapSite(row) : null;
}

/**
 * Public widget lookup by site key. Deliberately global: the key is the
 * widget's public identity, and ownership comes back as `site.ownerId`.
 */
export function getSiteByKey(db: DB, siteKey: string): Site | null {
  const row = db.prepare('SELECT * FROM sites WHERE site_key = ?').get(siteKey) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSite(row) : null;
}

/**
 * All configured origins, used only for widget CORS preflight when the caller
 * has not named a site key yet. Not an admin data accessor.
 */
export function listAllAllowedOrigins(db: DB): string[] {
  return (db.prepare('SELECT allowed_origins FROM sites').all() as Row[]).flatMap((row) =>
    parseJson<string[]>(String(row.allowed_origins), []),
  );
}

export function createSite(db: DB, ownerId: number, input: SiteInput): Site {
  const info = db
    .prepare(
      `INSERT INTO sites (owner_id, name, site_key, allowed_origins, rate_limit_per_min, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ownerId,
      input.name,
      input.siteKey,
      JSON.stringify(input.allowedOrigins),
      input.rateLimitPerMin,
      nowIso(),
    );
  return getSiteById(db, ownerId, Number(info.lastInsertRowid))!;
}

export function updateSite(
  db: DB,
  ownerId: number,
  id: number,
  input: Partial<SiteInput>,
): Site | null {
  const existing = getSiteById(db, ownerId, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE sites SET name = ?, site_key = ?, allowed_origins = ?, rate_limit_per_min = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    merged.name,
    merged.siteKey,
    JSON.stringify(merged.allowedOrigins),
    merged.rateLimitPerMin,
    id,
    ownerId,
  );
  return getSiteById(db, ownerId, id);
}

export function deleteSite(db: DB, ownerId: number, id: number): boolean {
  if (!getSiteById(db, ownerId, id)) return false;
  const conversations = db
    .prepare('SELECT COUNT(*) AS count FROM conversations WHERE site_id = ?')
    .get(id) as { count: number };
  if (conversations.count > 0) {
    throw new Error('Cannot delete a site that has conversations');
  }
  return db.prepare('DELETE FROM sites WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0;
}

// ---------------------------------------------------------------------------
// Conversations & messages repository
// ---------------------------------------------------------------------------

/** Conversations belong to a site, and a site belongs to an owner. */
const OWNED_SITE = 'site_id IN (SELECT id FROM sites WHERE owner_id = ?)';

export function createConversation(
  db: DB,
  ownerId: number,
  input: { id: string; siteId: number; visitorId?: string; topIntent?: string },
): Conversation {
  if (!getSiteById(db, ownerId, input.siteId)) {
    throw new Error('Cannot create a conversation for a site owned by another user');
  }
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, started_at, last_at, needs_human, handled, top_intent)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(input.id, input.siteId, input.visitorId ?? '', now, now, input.topIntent ?? 'other');
  return getConversation(db, ownerId, input.id)!;
}

export function getConversation(db: DB, ownerId: number, id: string): Conversation | null {
  const row = db
    .prepare(
      `SELECT c.* FROM conversations c
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = ? AND s.owner_id = ?`,
    )
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? mapConversation(row) : null;
}

export function touchConversation(
  db: DB,
  ownerId: number,
  id: string,
  updates: { topIntent?: string; needsHuman?: boolean } = {},
): void {
  const sets = ['last_at = ?'];
  const params: unknown[] = [nowIso()];
  if (updates.topIntent) {
    sets.push('top_intent = ?');
    params.push(updates.topIntent);
  }
  if (updates.needsHuman !== undefined) {
    sets.push('needs_human = ?');
    params.push(updates.needsHuman ? 1 : 0);
  }
  params.push(id, ownerId);
  db.prepare(
    `UPDATE conversations SET ${sets.join(', ')} WHERE id = ? AND ${OWNED_SITE}`,
  ).run(...params);
}

export function setConversationHandled(
  db: DB,
  ownerId: number,
  id: string,
  handled: boolean,
): boolean {
  return (
    db
      .prepare(`UPDATE conversations SET handled = ? WHERE id = ? AND ${OWNED_SITE}`)
      .run(handled ? 1 : 0, id, ownerId).changes > 0
  );
}

export interface ConversationListOptions {
  siteId?: number;
  needsHuman?: boolean;
  handled?: boolean;
  limit?: number;
  offset?: number;
}

export function listConversations(
  db: DB,
  ownerId: number,
  options: ConversationListOptions = {},
): { items: ConversationSummary[]; total: number } {
  const where: string[] = ['s.owner_id = ?'];
  const params: unknown[] = [ownerId];
  if (options.siteId) {
    where.push('c.site_id = ?');
    params.push(options.siteId);
  }
  if (options.needsHuman !== undefined) {
    where.push('c.needs_human = ?');
    params.push(options.needsHuman ? 1 : 0);
  }
  if (options.handled !== undefined) {
    where.push('c.handled = ?');
    params.push(options.handled ? 1 : 0);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const fromSql = 'FROM conversations c JOIN sites s ON s.id = c.site_id';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count ${fromSql} ${whereSql}`).get(...params) as {
      count: number;
    }
  ).count;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT c.*, s.name AS site_name,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       ${fromSql}
       ${whereSql}
       ORDER BY c.last_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return {
    items: rows.map((row) => ({
      ...mapConversation(row),
      siteName: String(row.site_name),
      messageCount: Number(row.message_count),
    })),
    total,
  };
}

export function countConversations(db: DB, ownerId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM conversations c
         JOIN sites s ON s.id = c.site_id
         WHERE s.owner_id = ?`,
      )
      .get(ownerId) as { count: number }
  ).count;
}

export function addMessage(
  db: DB,
  ownerId: number,
  input: {
    id: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    intent?: string;
    createdAt?: string;
  },
): Message {
  if (!getConversation(db, ownerId, input.conversationId)) {
    throw new Error('Cannot add a message to a conversation owned by another user');
  }
  const createdAt = input.createdAt ?? nowIso();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, intent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.conversationId, input.role, input.content, input.intent ?? '', createdAt);
  return {
    id: input.id,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    intent: input.intent ?? '',
    createdAt,
  };
}

export function listMessages(db: DB, ownerId: number, conversationId: string): Message[] {
  return (
    db
      .prepare(
        `SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN sites s ON s.id = c.site_id
         WHERE m.conversation_id = ? AND s.owner_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(conversationId, ownerId) as Row[]
  ).map(mapMessage);
}

export function deleteConversation(db: DB, ownerId: number, id: string): boolean {
  return (
    db
      .prepare(`DELETE FROM conversations WHERE id = ? AND ${OWNED_SITE}`)
      .run(id, ownerId).changes > 0
  );
}

// ---------------------------------------------------------------------------
// Copy history repository
// ---------------------------------------------------------------------------

export function addCopyHistory(
  db: DB,
  ownerId: number,
  input: {
    id: string;
    productId?: number | null;
    params: Record<string, unknown>;
    outputs: Record<string, unknown>;
  },
): CopyHistoryEntry {
  if (input.productId != null && !getProduct(db, ownerId, input.productId)) {
    throw new Error('Cannot attach copy history to a product owned by another user');
  }
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO copy_history (owner_id, id, product_id, params, outputs, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    input.id,
    input.productId ?? null,
    JSON.stringify(input.params),
    JSON.stringify(input.outputs),
    createdAt,
  );
  return {
    id: input.id,
    productId: input.productId ?? null,
    params: input.params,
    outputs: input.outputs,
    createdAt,
  };
}

function mapCopyHistory(row: Row): CopyHistoryEntry {
  return {
    id: String(row.id),
    productId: row.product_id === null ? null : Number(row.product_id),
    params: parseJson<Record<string, unknown>>(String(row.params), {}),
    outputs: parseJson<Record<string, unknown>>(String(row.outputs), {}),
    createdAt: String(row.created_at),
  };
}

export function listCopyHistory(
  db: DB,
  ownerId: number,
  options: { limit?: number; productId?: number } = {},
): CopyHistoryEntry[] {
  const where = ['owner_id = ?'];
  const params: unknown[] = [ownerId];
  if (options.productId) {
    where.push('product_id = ?');
    params.push(options.productId);
  }
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  params.push(limit);
  return (
    db
      .prepare(
        `SELECT * FROM copy_history WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as Row[]
  ).map(mapCopyHistory);
}

export function getCopyHistory(db: DB, ownerId: number, id: string): CopyHistoryEntry | null {
  const row = db
    .prepare('SELECT * FROM copy_history WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? mapCopyHistory(row) : null;
}

export const SCHEMA_VERSION = MIGRATIONS.length;
