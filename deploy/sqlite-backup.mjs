#!/usr/bin/env node
// Fallback for hosts without the sqlite3 CLI. Uses better-sqlite3's online
// backup API (equivalent to `sqlite3 DB ".backup OUT"`) and verifies integrity.
// The binary comes from the release's traced node_modules.
//
//   node deploy/sqlite-backup.mjs --db /var/lib/shoppulse-ai/shoppulse.db \
//                                 --out /tmp/copy.db
//
// Prints "ok" on success; exits non-zero with a message on failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dbPath = arg('--db');
const outPath = arg('--out');
if (!dbPath || !outPath) {
  console.error('Usage: node sqlite-backup.mjs --db SOURCE --out DEST');
  process.exit(1);
}

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  // Script lives in deploy/ inside a release; node_modules is one level up.
  const modulePath = path.join(here, '..', 'node_modules', 'better-sqlite3', 'lib', 'index.js');
  Database = (await import(modulePath)).default;
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  await db.backup(outPath);
} finally {
  db.close();
}

const copy = new Database(outPath, { readonly: true, fileMustExist: true });
try {
  const result = copy.pragma('integrity_check', { simple: true });
  if (result !== 'ok') {
    console.error(`integrity check failed: ${result}`);
    process.exit(2);
  }
} finally {
  copy.close();
}

process.stdout.write('ok\n');
