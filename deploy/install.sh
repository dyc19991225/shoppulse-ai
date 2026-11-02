#!/usr/bin/env bash
# Install or upgrade ShopPulse AI on zz from a release tarball.
#
#   sudo bash install.sh --tarball /tmp/shoppulse-ai-0.1.0-...tar.gz
#
# Creates the shoppulse system user, lays releases out under /opt/shoppulse-ai
# (current -> releases/<id>), installs the systemd unit + backup timer, creates
# a 0600 env file on first install, then starts the service and checks health.
# Existing env files are never overwritten.
set -euo pipefail

SERVICE="shoppulse-ai"
RUN_USER="shoppulse"
PREFIX="/opt/shoppulse-ai"
DATA_DIR="/var/lib/shoppulse-ai"
UNIT_DIR="/etc/systemd/system"
BACKUP_DIR="/var/backups/shoppulse-ai"
KEEP_RELEASES=3
TARBALL=""
NO_START=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: sudo bash install.sh --tarball FILE [options]

Options:
  --tarball FILE   Release tarball built by deploy/build-release.sh (required)
  --prefix DIR     Install prefix (default: /opt/shoppulse-ai)
  --data-dir DIR   SQLite data directory (default: /var/lib/shoppulse-ai)
  --no-start       Install files but do not enable/start the service
  --yes            Do not prompt for confirmation
  -h, --help       Show this help
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '==> %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball)
      [[ $# -ge 2 ]] || die "--tarball requires a file"
      TARBALL="$2"
      shift 2
      ;;
    --prefix)
      [[ $# -ge 2 ]] || die "--prefix requires a directory"
      PREFIX="${2%/}"
      shift 2
      ;;
    --data-dir)
      [[ $# -ge 2 ]] || die "--data-dir requires a directory"
      DATA_DIR="${2%/}"
      shift 2
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --yes|-y)
      ASSUME_YES=1
      shift
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

[[ $EUID -eq 0 ]] || die "must run as root (use sudo)"
[[ -n "$TARBALL" ]] || die "--tarball is required (try --help)"
[[ -f "$TARBALL" ]] || die "tarball not found: $TARBALL"
command -v node >/dev/null 2>&1 || die "node is not installed"
command -v systemctl >/dev/null 2>&1 || die "systemctl is not available"
command -v tar >/dev/null 2>&1 || die "tar is not available"
command -v curl >/dev/null 2>&1 || die "curl is not installed"

if [[ "$ASSUME_YES" -eq 0 ]]; then
  printf 'Install %s into %s? [y/N] ' "$TARBALL" "$PREFIX"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
fi

WORK_DIR="$(mktemp -d /tmp/shoppulse-install.XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
  return 0
}
trap cleanup EXIT

log "extracting $(basename "$TARBALL")"
tar -xzf "$TARBALL" -C "$WORK_DIR"

SRC=""
if [[ -f "$WORK_DIR/server.js" ]]; then
  SRC="$WORK_DIR"
else
  for candidate in "$WORK_DIR"/*/; do
    if [[ -f "${candidate}server.js" ]]; then
      SRC="${candidate%/}"
      break
    fi
  done
fi
[[ -n "$SRC" ]] || die "server.js not found in tarball"

[[ -f "$SRC/BUILD_INFO" ]] || die "BUILD_INFO missing — was this built by build-release.sh?"
BUILD_NODE_MAJOR="$(sed -n 's/^node_major=//p' "$SRC/BUILD_INFO" | head -n1)"
BUILD_COMMIT="$(sed -n 's/^commit=//p' "$SRC/BUILD_INFO" | head -n1)"
BUILD_VERSION="$(sed -n 's/^version=//p' "$SRC/BUILD_INFO" | head -n1)"
CURRENT_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"

if [[ -n "$BUILD_NODE_MAJOR" && "$BUILD_NODE_MAJOR" != "$CURRENT_NODE_MAJOR" ]]; then
  die "Node major mismatch: release built with Node $BUILD_NODE_MAJOR, this host has $(node -v). better-sqlite3 is ABI-specific; install Node $BUILD_NODE_MAJOR on zz or rebuild the release on a matching toolchain."
fi

[[ -f "$SRC/server.js" ]] || die "server.js missing"
[[ -d "$SRC/.next/static" ]] || die ".next/static missing"
[[ -f "$SRC/public/widget.js" ]] || die "public/widget.js missing"
[[ -f "$SRC/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]] \
  || die "better-sqlite3 native binding missing"

if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  log "creating system user $RUN_USER"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin --no-create-home "$RUN_USER"
fi

log "creating directories"
mkdir -p "$PREFIX/releases" "$DATA_DIR" "$BACKUP_DIR"
chown "$RUN_USER:$RUN_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
chmod 700 "$BACKUP_DIR"

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_COMMIT:-unknown}"
RELEASE_DIR="$PREFIX/releases/$RELEASE_ID"
[[ ! -e "$RELEASE_DIR" ]] || die "release already exists: $RELEASE_DIR"

log "installing release $BUILD_VERSION ($RELEASE_ID)"
mv "$SRC" "$RELEASE_DIR"
chown -R root:root "$RELEASE_DIR"
chmod -R u=rwX,go=rX "$RELEASE_DIR"
chmod +x "$RELEASE_DIR/deploy/install.sh" "$RELEASE_DIR/deploy/backup.sh" \
  "$RELEASE_DIR/deploy/user.mjs"

PREVIOUS=""
if [[ -L "$PREFIX/current" ]]; then
  PREVIOUS="$(readlink -f "$PREFIX/current" || true)"
fi

ln -sfn "$RELEASE_DIR" "$PREFIX/current.new"
mv -Tf "$PREFIX/current.new" "$PREFIX/current"

ENV_FILE="$PREFIX/shoppulse.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "creating $ENV_FILE (chmod 600)"
  cp "$RELEASE_DIR/deploy/shoppulse.env.example" "$ENV_FILE"
  sed -i "s#^SHOPPULSE_DB_PATH=.*#SHOPPULSE_DB_PATH=$DATA_DIR/shoppulse.db#" "$ENV_FILE"
  SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=$SECRET#" "$ENV_FILE"
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  FIRST_INSTALL=1
else
  chmod 600 "$ENV_FILE"
  FIRST_INSTALL=0
fi

log "installing systemd units"
sed "s#/opt/shoppulse-ai#$PREFIX#g; s#/var/lib/shoppulse-ai#$DATA_DIR#g" \
  "$RELEASE_DIR/deploy/shoppulse-ai.service" > "$UNIT_DIR/$SERVICE.service"
sed "s#/opt/shoppulse-ai#$PREFIX#g; s#/var/lib/shoppulse-ai#$DATA_DIR#g" \
  "$RELEASE_DIR/deploy/shoppulse-backup.service" > "$UNIT_DIR/shoppulse-backup.service"
cp "$RELEASE_DIR/deploy/shoppulse-backup.timer" "$UNIT_DIR/shoppulse-backup.timer"
chmod 644 "$UNIT_DIR/$SERVICE.service" "$UNIT_DIR/shoppulse-backup.service" "$UNIT_DIR/shoppulse-backup.timer"

systemctl daemon-reload
systemctl enable "$SERVICE.service" >/dev/null
systemctl enable --now shoppulse-backup.timer >/dev/null

if [[ "$NO_START" -eq 0 ]]; then
  log "starting $SERVICE"
  systemctl restart "$SERVICE.service"

  HEALTH_URL="http://127.0.0.1:8802/api/health"
  STATUS="000"
  for _ in $(seq 1 30); do
    STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
    [[ "$STATUS" == "200" ]] && break
    sleep 1
  done

  if [[ "$STATUS" == "200" ]]; then
    log "health check OK ($HEALTH_URL)"
  elif [[ "$STATUS" == "503" ]]; then
    printf 'warning: service is up but /api/health reports 503 (LLM/admin env not configured).\n' >&2
    printf '         Edit %s, then: systemctl restart %s\n' "$ENV_FILE" "$SERVICE" >&2
  else
    printf 'error: health check failed (HTTP %s). Inspect: journalctl -u %s -n 80\n' "$STATUS" "$SERVICE" >&2
    exit 1
  fi
fi

log "pruning old releases (keeping $KEEP_RELEASES newest, current always kept)"
CURRENT_REAL="$(readlink -f "$PREFIX/current" || true)"
mapfile -t RELEASES < <(find "$PREFIX/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
KEPT=0
for name in "${RELEASES[@]}"; do
  dir="$PREFIX/releases/$name"
  if [[ "$dir" == "$CURRENT_REAL" ]]; then
    KEPT=$((KEPT + 1))
    continue
  fi
  if [[ "$KEPT" -lt "$KEEP_RELEASES" ]]; then
    KEPT=$((KEPT + 1))
  else
    rm -rf "$dir"
  fi
done

if [[ -n "$PREVIOUS" && -d "$PREVIOUS" && "$PREVIOUS" != "$CURRENT_REAL" ]]; then
  log "previous release kept for rollback: $PREVIOUS"
fi

echo
if [[ "$FIRST_INSTALL" -eq 1 ]]; then
  cat <<EOF
First install complete.

Next steps (required before going live):
  1. Edit $ENV_FILE (already chmod 600):
       - SHOPPULSE_LLM_API_KEY=<gateway key>
       - ADMIN_PASSWORD_HASH=<run: node $PREFIX/current/deploy/hash-password.mjs --stdin>
  2. systemctl restart $SERVICE
  3. Add the Caddy site block from deploy/Caddyfile.shop-ai.dycxy.shop.
  4. curl -fsS http://127.0.0.1:8802/api/health

Live URL: TBD (pending user confirmation). See DEPLOY.md.
EOF
else
  echo "Upgrade complete. Env file left untouched: $ENV_FILE"
fi
