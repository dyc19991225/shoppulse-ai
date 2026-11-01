import { loadConfig } from './config';
import { openDb, type DB } from './db';

let cached: { key: string; db: DB } | null = null;

/**
 * Process-wide SQLite handle. Keyed by path so tests can stub
 * SHOPPULSE_DB_PATH and call resetDbCache().
 */
export function getDb(): DB {
  const config = loadConfig();
  if (!cached || cached.key !== config.dbPath) {
    if (cached) cached.db.close();
    cached = { key: config.dbPath, db: openDb({ dbPath: config.dbPath }) };
  }
  return cached.db;
}

/** Test helper: closes and forgets the cached handle. */
export function resetDbCache(): void {
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // already closed
    }
  }
  cached = null;
}
