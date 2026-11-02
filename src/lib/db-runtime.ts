import { loadConfig } from './config';
import { ensureEnvAdmin, openDb, type DB } from './db';

let cached: { key: string; db: DB } | null = null;

/**
 * Process-wide SQLite handle. Keyed by path so tests can stub
 * SHOPPULSE_DB_PATH and call resetDbCache().
 */
export function getDb(): DB {
  // The database must stay available even when the LLM is misconfigured so
  // /api/health can report the promised 503 instead of crashing.
  const config = loadConfig(undefined, { checkLlmReady: false });
  if (!cached || cached.key !== config.dbPath) {
    if (cached) cached.db.close();
    cached = { key: config.dbPath, db: openDb({ dbPath: config.dbPath }) };
  }
  // Cheap idempotent check on every call: keeps user 1 named like the env
  // admin even when the env file changes without a restart of this process.
  ensureEnvAdmin(cached.db, config);
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
