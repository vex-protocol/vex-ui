#!/usr/bin/env bash
# Builds and publishes @vex-chat packages to local Verdaccio.
#
# Usage:
#   pnpm registry                    # start Verdaccio first
#   pnpm publish:local               # publish all (types → crypto → libvex)
#   pnpm publish:local types         # publish just types
#   pnpm publish:local crypto libvex # publish crypto + libvex
#   pnpm publish:local --dry-run     # show what would be published
#   pnpm publish:local crypto --dry-run

set -euo pipefail

REGISTRY="${VERDACCIO_URL:-http://localhost:4873}"
NPM_REGISTRY="https://registry.npmjs.org"
DRY_RUN=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROTOCOL_DIR="${VEX_PROTOCOL_DIR:-$ROOT_DIR/../vex-protocol}"

resolve_pkg_dir() {
  case "$1" in
    types)
      for dir in "$PROTOCOL_DIR/packages/types" "$ROOT_DIR/../types-js"; do
        [ -f "$dir/package.json" ] && echo "$dir" && return 0
      done
      ;;
    crypto)
      for dir in "$PROTOCOL_DIR/packages/crypto" "$ROOT_DIR/../crypto-js"; do
        [ -f "$dir/package.json" ] && echo "$dir" && return 0
      done
      ;;
    libvex)
      for dir in "$PROTOCOL_DIR/packages/libvex" "$ROOT_DIR/../libvex-js"; do
        [ -f "$dir/package.json" ] && echo "$dir" && return 0
      done
      ;;
  esac
  return 1
}

# ── Parse args ──
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
    types|crypto|libvex) TARGETS+=("$arg") ;;
    *)            echo "Unknown arg: $arg"; echo "Targets: types, crypto, libvex"; echo "Flags: --dry-run"; exit 1 ;;
  esac
done

# Default: all in dependency order
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(types crypto libvex)
fi

if [ "$DRY_RUN" = false ]; then
  # Verify Verdaccio is running
  if ! curl -sf "$REGISTRY/-/ping" > /dev/null 2>&1; then
    echo "ERROR: Verdaccio not running at $REGISTRY"
    echo "Start it first: pnpm registry"
    exit 1
  fi

  # Ensure .npmrc exists in every consumer
  NPMRC_LINE="@vex-chat:registry=$REGISTRY"
  AUTH_HOST="${REGISTRY#http://}"
  AUTH_HOST="${AUTH_HOST#https://}"
  AUTH_LINE="//$AUTH_HOST/:_authToken=local-dev-token"
  for dir in \
    "$ROOT_DIR" \
    "$PROTOCOL_DIR" \
    "$PROTOCOL_DIR/packages/types" \
    "$PROTOCOL_DIR/packages/crypto" \
    "$PROTOCOL_DIR/packages/libvex" \
    "$ROOT_DIR/../libvex-js" \
    "$ROOT_DIR/../crypto-js" \
    "$ROOT_DIR/../spire" \
    "$ROOT_DIR/../types-js"; do
    if [ -d "$dir" ]; then
      rc="$dir/.npmrc"
      if [ ! -f "$rc" ] || ! grep -qF "$NPMRC_LINE" "$rc"; then
        echo "$NPMRC_LINE" >> "$rc"
        echo "  Added registry to $rc"
      fi
      if ! grep -qF "$AUTH_LINE" "$rc"; then
        echo "$AUTH_LINE" >> "$rc"
      fi
    fi
  done
fi

PUBLISHED_VERSIONS=""
HAS_ERROR=false

for target in "${TARGETS[@]}"; do
  if ! pkg="$(resolve_pkg_dir "$target")"; then
    echo "SKIP: no package.json found for target '$target'"
    continue
  fi

  if [ ! -f "$pkg/package.json" ]; then
    echo "SKIP: $pkg/package.json not found"
    continue
  fi

  name=$(node -p "require('$pkg/package.json').name")
  ver=$(node -p "require('$pkg/package.json').version")

  # Check if this exact version exists on the real npm registry
  npm_status=$(curl -sf "$NPM_REGISTRY/$name/$ver" > /dev/null 2>&1 && echo "exists" || echo "not-found")

  echo ""
  if [ "$DRY_RUN" = true ]; then
    echo "=== DRY RUN: $name@$ver ==="
    echo "  Source: $pkg"
    echo "  Branch: $(cd "$pkg" && git branch --show-current 2>/dev/null || echo 'detached')"
    if [ "$npm_status" = "exists" ]; then
      echo "  ⚠ WARNING: $name@$ver already exists on npm — bump version before publishing"
      HAS_ERROR=true
    else
    echo "  ✓ $name@$ver not on npm — safe to publish"
    fi
    echo "  Contents:"
    (cd "$pkg" && pnpm pack --dry-run 2>&1 | sed 's/^/    /' | head -25) || true
    continue
  fi

  if [ "$npm_status" = "exists" ]; then
    echo "ERROR: $name@$ver already exists on npm. Bump the version in $pkg/package.json first."
    HAS_ERROR=true
    continue
  fi

  echo "=== $name@$ver ==="

  pushd "$pkg" > /dev/null

  echo "  Building..."
  pnpm --if-present run build 2>&1 | sed 's/^/  /'

  echo "  Publishing to $REGISTRY..."
  pnpm publish --registry "$REGISTRY" --tag local --access public --no-git-checks 2>&1 | sed 's/^/  /'

  PUBLISHED_VERSIONS="$PUBLISHED_VERSIONS  $name@$ver\n"

  popd > /dev/null
done

if [ "$DRY_RUN" = true ]; then
  echo ""
  if [ "$HAS_ERROR" = true ]; then
    echo "(dry run — version conflicts found, fix before publishing)"
    exit 1
  fi
  echo "(dry run — nothing published)"
else
  echo ""
  if [ "$HAS_ERROR" = true ]; then
    echo "Some packages skipped due to version conflicts."
    exit 1
  fi
  echo "Published:"
  echo -e "$PUBLISHED_VERSIONS"
fi
