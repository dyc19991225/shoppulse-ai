import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;
type Row = Record<string, unknown>;

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  // v1
  `
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
  `,
];

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
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const run = db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    });
    run();
  }
}

export const DEFAULT_SITE_NAME = '默认站点';
export const DEFAULT_SITE_KEY = 'demo-site-key';
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Creates the default widget site on first boot if no sites exist. */
export function ensureDefaultSite(db: DB): number {
  const existing = db
    .prepare('SELECT id FROM sites ORDER BY id LIMIT 1')
    .get() as { id: number } | undefined;
  if (existing) return existing.id;

  const info = db
    .prepare(
      `INSERT INTO sites (name, site_key, allowed_origins, rate_limit_per_min, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
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

export function listKbEntries(db: DB, options: KbListOptions = {}): KbEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.enabledOnly) where.push('enabled = 1');
  if (options.search?.trim()) {
    const like = `%${options.search.trim()}%`;
    where.push('(title LIKE ? OR content LIKE ? OR keywords LIKE ?)');
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM kb_entries ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY updated_at DESC, id DESC ${options.limit ? 'LIMIT ?' : ''}`;
  if (options.limit) params.push(options.limit);
  return (db.prepare(sql).all(...params) as Row[]).map(mapKb);
}

export function getKbEntry(db: DB, id: number): KbEntry | null {
  const row = db.prepare('SELECT * FROM kb_entries WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapKb(row) : null;
}

export function createKbEntry(db: DB, input: KbInput): KbEntry {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO kb_entries (type, title, content, keywords, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.type ?? 'faq',
      input.title,
      input.content,
      input.keywords ?? '',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return getKbEntry(db, Number(info.lastInsertRowid))!;
}

export function updateKbEntry(
  db: DB,
  id: number,
  input: Partial<KbInput>,
): KbEntry | null {
  const existing = getKbEntry(db, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE kb_entries
     SET type = ?, title = ?, content = ?, keywords = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    merged.type,
    merged.title,
    merged.content,
    merged.keywords,
    merged.enabled ? 1 : 0,
    nowIso(),
    id,
  );
  return getKbEntry(db, id);
}

export function deleteKbEntry(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id).changes > 0;
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

export function listProducts(db: DB, options: ProductListOptions = {}): Product[] {
  const where: string[] = [];
  const params: unknown[] = [];
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
  const sql = `SELECT * FROM products ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY updated_at DESC, id DESC ${options.limit ? 'LIMIT ?' : ''}`;
  if (options.limit) params.push(options.limit);
  return (db.prepare(sql).all(...params) as Row[]).map(mapProduct);
}

export function getProduct(db: DB, id: number): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapProduct(row) : null;
}

export function getProductBySku(db: DB, sku: string): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku) as
    | Record<string, unknown>
    | undefined;
  return row ? mapProduct(row) : null;
}

export function createProduct(db: DB, input: ProductInput): Product {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO products
       (sku, name, category, price, stock, description, selling_points, image_url, url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
  return getProduct(db, Number(info.lastInsertRowid))!;
}

export function updateProduct(
  db: DB,
  id: number,
  input: Partial<ProductInput>,
): Product | null {
  const existing = getProduct(db, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE products
     SET sku = ?, name = ?, category = ?, price = ?, stock = ?, description = ?,
         selling_points = ?, image_url = ?, url = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
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
  );
  return getProduct(db, id);
}

export function deleteProduct(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM products WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Sites repository
// ---------------------------------------------------------------------------

export function listSites(db: DB): Site[] {
  return (db.prepare('SELECT * FROM sites ORDER BY id ASC').all() as Row[]).map(mapSite);
}

export function getSiteById(db: DB, id: number): Site | null {
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSite(row) : null;
}

export function getSiteByKey(db: DB, siteKey: string): Site | null {
  const row = db.prepare('SELECT * FROM sites WHERE site_key = ?').get(siteKey) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSite(row) : null;
}

export function createSite(db: DB, input: SiteInput): Site {
  const info = db
    .prepare(
      `INSERT INTO sites (name, site_key, allowed_origins, rate_limit_per_min, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.siteKey,
      JSON.stringify(input.allowedOrigins),
      input.rateLimitPerMin,
      nowIso(),
    );
  return getSiteById(db, Number(info.lastInsertRowid))!;
}

export function updateSite(
  db: DB,
  id: number,
  input: Partial<SiteInput>,
): Site | null {
  const existing = getSiteById(db, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE sites SET name = ?, site_key = ?, allowed_origins = ?, rate_limit_per_min = ?
     WHERE id = ?`,
  ).run(
    merged.name,
    merged.siteKey,
    JSON.stringify(merged.allowedOrigins),
    merged.rateLimitPerMin,
    id,
  );
  return getSiteById(db, id);
}

export function deleteSite(db: DB, id: number): boolean {
  const conversations = db
    .prepare('SELECT COUNT(*) AS count FROM conversations WHERE site_id = ?')
    .get(id) as { count: number };
  if (conversations.count > 0) {
    throw new Error('Cannot delete a site that has conversations');
  }
  return db.prepare('DELETE FROM sites WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Conversations & messages repository
// ---------------------------------------------------------------------------

export function createConversation(
  db: DB,
  input: { id: string; siteId: number; visitorId?: string; topIntent?: string },
): Conversation {
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, started_at, last_at, needs_human, handled, top_intent)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(input.id, input.siteId, input.visitorId ?? '', now, now, input.topIntent ?? 'other');
  return getConversation(db, input.id)!;
}

export function getConversation(db: DB, id: string): Conversation | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapConversation(row) : null;
}

export function touchConversation(
  db: DB,
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
  params.push(id);
  db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function setConversationHandled(db: DB, id: string, handled: boolean): boolean {
  return (
    db.prepare('UPDATE conversations SET handled = ? WHERE id = ?').run(handled ? 1 : 0, id)
      .changes > 0
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
  options: ConversationListOptions = {},
): { items: ConversationSummary[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM conversations c ${whereSql}`).get(...params) as {
      count: number;
    }
  ).count;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT c.*, s.name AS site_name,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       JOIN sites s ON s.id = c.site_id
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

export function countConversations(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM conversations').get() as { count: number })
    .count;
}

export function addMessage(
  db: DB,
  input: {
    id: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    intent?: string;
    createdAt?: string;
  },
): Message {
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

export function listMessages(db: DB, conversationId: string): Message[] {
  return (
    db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversationId) as Row[]
  ).map(mapMessage);
}

export function deleteConversation(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Copy history repository
// ---------------------------------------------------------------------------

export function addCopyHistory(
  db: DB,
  input: {
    id: string;
    productId?: number | null;
    params: Record<string, unknown>;
    outputs: Record<string, unknown>;
  },
): CopyHistoryEntry {
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO copy_history (id, product_id, params, outputs, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(input.id, input.productId ?? null, JSON.stringify(input.params), JSON.stringify(input.outputs), createdAt);
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
  options: { limit?: number; productId?: number } = {},
): CopyHistoryEntry[] {
  const where = options.productId ? 'WHERE product_id = ?' : '';
  const params: unknown[] = options.productId ? [options.productId] : [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  params.push(limit);
  return (
    db
      .prepare(`SELECT * FROM copy_history ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Row[]
  ).map(mapCopyHistory);
}

export function getCopyHistory(db: DB, id: string): CopyHistoryEntry | null {
  const row = db.prepare('SELECT * FROM copy_history WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapCopyHistory(row) : null;
}

export { SCHEMA_VERSION };
