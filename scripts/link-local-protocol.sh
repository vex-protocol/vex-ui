#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOCOL_DIR="${VEX_PROTOCOL_DIR:-$ROOT_DIR/../vex-protocol}"
LIBVEX_DIR="$PROTOCOL_DIR/packages/libvex"

if [[ ! -f "$LIBVEX_DIR/package.json" ]]; then
    echo "Local libvex package not found at $LIBVEX_DIR" >&2
    echo "Set VEX_PROTOCOL_DIR=/path/to/vex-protocol if it lives elsewhere." >&2
    exit 1
fi

for target in "$ROOT_DIR/packages/store" "$ROOT_DIR/apps/mobile" "$ROOT_DIR/apps/desktop"; do
    mkdir -p "$target/node_modules/@vex-chat"
    ln -sfn "$LIBVEX_DIR" "$target/node_modules/@vex-chat/libvex"
    echo "Linked @vex-chat/libvex in ${target#$ROOT_DIR/}"
done

echo "Local protocol linked from $PROTOCOL_DIR"
