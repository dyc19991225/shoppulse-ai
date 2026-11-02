#!/usr/bin/env bash
# Build a self-contained ShopPulse AI release tarball on the build box.
#
#   bash deploy/build-release.sh                 # npm ci + next build
#   bash deploy/build-release.sh --skip-install  # reuse existing node_modules
#   bash deploy/build-release.sh --skip-build    # re-pack an existing .next
#
# The tarball contains the Next.js standalone server, static assets, public
# files (widget.js), production deploy scripts and docs. better-sqlite3 is
# compiled for this machine, so the target server must run the same Node major.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
SKIP_INSTALL=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage: bash deploy/build-release.sh [options]

Options:
  --out DIR        Write the tarball to DIR (default: ./dist)
  --skip-install   Do not run npm ci
  --skip-build     Do not run npm run build (pack the existing .next output)
  -h, --help       Show this help
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -ge 2 ]] || die "--out requires a directory"
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
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

cd "$ROOT_DIR"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm >/dev/null 2>&1 || die "npm is not installed"

NODE_VERSION="$(node -v)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
PLATFORM="$(node -p 'process.platform')"
ARCH="$(node -p 'process.arch')"
VERSION="$(node -p 'require("./package.json").version')"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
DIRTY="no"
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then DIRTY="yes"; fi
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  if [[ -f package-lock.json ]]; then
    echo "==> npm ci"
    npm ci
  else
    echo "==> npm install"
    npm install
  fi
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> npm run build"
  npm run build
fi

[[ -f .next/standalone/server.js ]] || die ".next/standalone/server.js missing — run npm run build first"
[[ -d .next/static ]] || die ".next/static missing — run npm run build first"
[[ -f public/widget.js ]] || die "public/widget.js missing"
[[ -f .next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node ]] \
  || die "better-sqlite3 native binding missing from standalone output"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="shoppulse-ai-${VERSION}-${STAMP}"
STAGE="$OUT_DIR/$NAME"
TARBALL="$OUT_DIR/${NAME}-${PLATFORM}-${ARCH}.tar.gz"

echo "==> staging release in $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/.next" "$STAGE/deploy" "$OUT_DIR"

# Next.js standalone server + its traced node_modules.
cp -a .next/standalone/. "$STAGE/"
# Static assets are intentionally not traced by standalone.
rm -rf "$STAGE/.next/static"
cp -a .next/static "$STAGE/.next/static"
# public/ (widget.js, etc.) must sit next to server.js.
rm -rf "$STAGE/public"
cp -a public "$STAGE/public"

# Deploy helpers and docs travel with the release so install/backup work on zz
# without the source tree or dev dependencies.
cp -a deploy/. "$STAGE/deploy/"
chmod +x "$STAGE/deploy/build-release.sh" "$STAGE/deploy/install.sh" "$STAGE/deploy/backup.sh" \
  "$STAGE/deploy/user.mjs"
cp -a README.md DEPLOY.md DELIVERY.md LICENSE "$STAGE/"

cat > "$STAGE/BUILD_INFO" <<EOF
name=shoppulse-ai
version=$VERSION
commit=$COMMIT
dirty=$DIRTY
built_at=$STAMP
node_version=$NODE_VERSION
node_major=$NODE_MAJOR
platform=$PLATFORM
arch=$ARCH
EOF

[[ -f "$STAGE/server.js" ]] || die "server.js missing from staging"
[[ -d "$STAGE/.next/static" ]] || die "static assets missing from staging"
[[ -f "$STAGE/public/widget.js" ]] || die "widget.js missing from staging"
[[ -f "$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]] \
  || die "better-sqlite3 binding missing from staging"

echo "==> packing $TARBALL"
tar -czf "$TARBALL" -C "$OUT_DIR" "$NAME"
rm -rf "$STAGE"

(
  cd "$OUT_DIR"
  sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256"
)

SIZE="$(du -h "$TARBALL" | cut -f1)"
echo
echo "Release ready: $TARBALL ($SIZE)"
echo "SHA256:        $(cut -d' ' -f1 "$TARBALL.sha256")"
echo "Node:          $NODE_VERSION ($PLATFORM/$ARCH)"
echo
echo "Upload both files, verify with 'sha256sum -c', then on zz:"
echo "  tar -xzf ${TARBALL##*/}"
echo "  sudo bash ${NAME}-${PLATFORM}-${ARCH}/deploy/install.sh --tarball ./${TARBALL##*/}"
