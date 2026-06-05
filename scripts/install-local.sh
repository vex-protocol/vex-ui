#!/usr/bin/env bash
# Installs @vex-chat packages from local Verdaccio into a target project.
#
# Usage:
#   pnpm install:local ui                 # install catalog versions into this monorepo
#   pnpm install:local store              # install catalog versions into this monorepo
#   pnpm install:local desktop            # install catalog versions into this monorepo
#   pnpm install:local mobile             # install catalog versions into this monorepo
#   pnpm install:local spire              # install types + crypto into legacy sibling spire
#   pnpm install:local libvex             # install types + crypto into legacy sibling libvex-js
#   pnpm install:local crypto             # install types into legacy sibling crypto-js
#   pnpm install:local spire types        # install only types into spire
#   pnpm install:local libvex crypto      # install only crypto into libvex-js

set -euo pipefail

REGISTRY="${VERDACCIO_URL:-http://localhost:4873}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <target> [packages...]"
  echo ""
  echo "Targets:"
  echo "  spire, libvex, crypto           (sibling repos)"
  echo "  store, desktop, mobile, website (monorepo packages)"
  echo ""
  echo "Packages (optional — defaults based on target's actual deps):"
  echo "  types, crypto, libvex"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROTOCOL_DIR="${VEX_PROTOCOL_DIR:-$ROOT_DIR/../vex-protocol}"

ensure_npmrc() {
  local dir="$1"
  local rc="$dir/.npmrc"
  local line="@vex-chat:registry=$REGISTRY"
  if [ ! -f "$rc" ] || ! grep -qF "$line" "$rc"; then
    echo "$line" >> "$rc"
  fi
}

# ── Resolve target directory ──
TARGET="$1"; shift
case "$TARGET" in
  ui|store|desktop|mobile|website)
    ensure_npmrc "$ROOT_DIR"
    echo "Installing @vex-chat catalog versions from $REGISTRY into vex-ui..."
    echo "Run this after updating pnpm-workspace.yaml to the local package versions."
    cd "$ROOT_DIR"
    pnpm install --registry "$REGISTRY"
    exit 0
    ;;
  spire)    DIR="$PROTOCOL_DIR/apps/spire" ;;
  libvex)   DIR="$PROTOCOL_DIR/packages/libvex" ;;
  crypto)   DIR="$PROTOCOL_DIR/packages/crypto" ;;
  *)        echo "Unknown target: $TARGET"; exit 1 ;;
esac

if [ ! -f "$DIR/package.json" ]; then
  echo "ERROR: $DIR/package.json not found"
  exit 1
fi

# ── Resolve which packages to install ──
PKGS=()
if [ $# -gt 0 ]; then
  # Explicit packages from args
  for arg in "$@"; do
    case "$arg" in
      types)  PKGS+=("@vex-chat/types@local") ;;
      crypto) PKGS+=("@vex-chat/crypto@local") ;;
      libvex) PKGS+=("@vex-chat/libvex@local") ;;
      *)      echo "Unknown package: $arg"; exit 1 ;;
    esac
  done
else
  # Auto-detect from package.json deps
  deps=$(node -p "
    const p = require('$DIR/package.json');
    const all = {...(p.dependencies||{}), ...(p.devDependencies||{}), ...(p.peerDependencies||{})};
    Object.keys(all).filter(k => k.startsWith('@vex-chat/')).join(',')
  ")
  IFS=',' read -ra found <<< "$deps"
  for dep in "${found[@]}"; do
    case "$dep" in
      @vex-chat/types)  PKGS+=("@vex-chat/types@local") ;;
      @vex-chat/crypto) PKGS+=("@vex-chat/crypto@local") ;;
      @vex-chat/libvex) PKGS+=("@vex-chat/libvex@local") ;;
      @vex-chat/store)  ;; # workspace package, skip
      *)                ;; # unknown, skip
    esac
  done
fi

if [ ${#PKGS[@]} -eq 0 ]; then
  echo "No @vex-chat packages to install in $TARGET"
  exit 0
fi

ensure_npmrc "$DIR"

echo "Installing into $TARGET ($DIR):"
echo "  ${PKGS[*]}"
echo ""

cd "$DIR"
pnpm add "${PKGS[@]}" --registry "$REGISTRY"
