import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB, type OpenDbOptions } from '@/lib/db';

export interface TempDb {
  db: DB;
  path: string;
  cleanup: () => void;
}

/**
 * Creates a migrated SQLite database in the OS temp dir. Tests must never touch
 * the real ./data/shoppulse.db.
 */
export function createTempDb(options: Omit<OpenDbOptions, 'dbPath'> = {}): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDb({ dbPath, ...options });

  return {
    db,
    path: dbPath,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // already closed
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
