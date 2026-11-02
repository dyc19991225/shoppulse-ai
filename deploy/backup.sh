#!/usr/bin/env bash
# Online SQLite backup for ShopPulse AI with 14-day retention.
#
#   sudo bash backup.sh
#   sudo bash backup.sh --db /var/lib/shoppulse-ai/shoppulse.db \
#                       --dest /var/backups/shoppulse-ai --retention-days 14
#
# Prefers the SQLite CLI's online backup (`.backup`) so the database stays
# consistent while the app is running; falls back to better-sqlite3's online
# backup API when the CLI is not installed. Each backup is integrity-checked,
# gzipped and written atomically. Backups older than the retention window are
# deleted. Run daily from shoppulse-backup.timer or cron.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="${SHOPPULSE_DB_PATH:-/var/lib/shoppulse-ai/shoppulse.db}"
BACKUP_DIR="${SHOPPULSE_BACKUP_DIR:-/var/backups/shoppulse-ai}"
RETENTION_DAYS="${SHOPPULSE_BACKUP_RETENTION_DAYS:-14}"
SQLITE3_BIN="${SQLITE3_BIN:-sqlite3}"
NODE_BIN="${NODE_BIN:-}"

usage() {
  cat <<'EOF'
Usage: sudo bash backup.sh [options]

Options:
  --db PATH             SQLite database (default: $SHOPPULSE_DB_PATH or
                        /var/lib/shoppulse-ai/shoppulse.db)
  --dest DIR            Backup directory (default: $SHOPPULSE_BACKUP_DIR or
                        /var/backups/shoppulse-ai)
  --retention-days N    Delete .db.gz backups older than N days (default: 14)
  -h, --help            Show this help
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      [[ $# -ge 2 ]] || die "--db requires a path"
      DB_PATH="$2"
      shift 2
      ;;
    --dest)
      [[ $# -ge 2 ]] || die "--dest requires a directory"
      BACKUP_DIR="$2"
      shift 2
      ;;
    --retention-days)
      [[ $# -ge 2 ]] || die "--retention-days requires a number"
      RETENTION_DAYS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] \
  || die "retention days must be a positive integer, got: $RETENTION_DAYS"
[[ -f "$DB_PATH" ]] || die "database not found: $DB_PATH"
command -v gzip >/dev/null 2>&1 || die "gzip not found"

BACKUP_MODE="cli"
if ! command -v "$SQLITE3_BIN" >/dev/null 2>&1; then
  BACKUP_MODE="node"
  [[ -n "$NODE_BIN" ]] || NODE_BIN="$(command -v node || true)"
  [[ -n "$NODE_BIN" ]] || die "neither sqlite3 CLI nor node found (install sqlite3)"
  [[ -f "$SCRIPT_DIR/sqlite-backup.mjs" ]] || die "sqlite-backup.mjs missing"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

exec 9> "$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  die "another backup is already running"
fi

TMP_DB=""
TMP_GZ=""
cleanup() {
  if [[ -n "$TMP_DB" && -f "$TMP_DB" ]]; then rm -f "$TMP_DB"; fi
  if [[ -n "$TMP_GZ" && -f "$TMP_GZ" ]]; then rm -f "$TMP_GZ"; fi
  return 0
}
trap cleanup EXIT

TMP_DB="$(mktemp "$BACKUP_DIR/.backup.XXXXXX.db")"
TMP_GZ="$(mktemp "$BACKUP_DIR/.backup.XXXXXX.gz")"

echo "==> backing up $DB_PATH (mode: $BACKUP_MODE)"
if [[ "$BACKUP_MODE" == "cli" ]]; then
  "$SQLITE3_BIN" "$DB_PATH" ".backup '$TMP_DB'"
  INTEGRITY="$("$SQLITE3_BIN" "$TMP_DB" 'PRAGMA integrity_check;')"
else
  "$NODE_BIN" "$SCRIPT_DIR/sqlite-backup.mjs" --db "$DB_PATH" --out "$TMP_DB" >/dev/null
  INTEGRITY="ok" # sqlite-backup.mjs already ran integrity_check
fi

if [[ "$INTEGRITY" != "ok" ]]; then
  die "integrity check failed: $INTEGRITY"
fi

gzip -9 -c "$TMP_DB" > "$TMP_GZ"
STAMP="$(date +%Y%m%d-%H%M%S)"
FINAL="$BACKUP_DIR/shoppulse-$STAMP.db.gz"
if [[ -e "$FINAL" ]]; then
  FINAL="$BACKUP_DIR/shoppulse-$STAMP-$$.db.gz"
fi
mv "$TMP_GZ" "$FINAL"
TMP_GZ=""
rm -f "$TMP_DB"
TMP_DB=""
chmod 600 "$FINAL"

SIZE="$(du -h "$FINAL" | cut -f1)"
echo "==> wrote $FINAL ($SIZE)"

PRUNED=0
while IFS= read -r old; do
  [[ -z "$old" ]] && continue
  rm -f "$old"
  PRUNED=$((PRUNED + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'shoppulse-*.db.gz' \
  -mtime +"$RETENTION_DAYS" -print)

# Leftover temp files from a previous crash.
find "$BACKUP_DIR" -maxdepth 1 -type f -name '.backup.*' -mmin +120 -delete 2>/dev/null || true

echo "==> retention: ${RETENTION_DAYS}d, pruned ${PRUNED} old backup(s)"
