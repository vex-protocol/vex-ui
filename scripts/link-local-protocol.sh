#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOCOL_DIR="${VEX_PROTOCOL_DIR:-$ROOT_DIR/../vex-protocol}"
PROTOCOL_PACKAGES=(libvex crypto types)

for package in "${PROTOCOL_PACKAGES[@]}"; do
    package_dir="$PROTOCOL_DIR/packages/$package"
    if [[ ! -f "$package_dir/package.json" ]]; then
        echo "Local @$package package not found at $package_dir" >&2
        echo "Set VEX_PROTOCOL_DIR=/path/to/vex-protocol if it lives elsewhere." >&2
        exit 1
    fi
done

for target in "$ROOT_DIR/packages/store" "$ROOT_DIR/apps/mobile" "$ROOT_DIR/apps/desktop"; do
    mkdir -p "$target/node_modules/@vex-chat"
    for package in "${PROTOCOL_PACKAGES[@]}"; do
        ln -sfn \
            "$PROTOCOL_DIR/packages/$package" \
            "$target/node_modules/@vex-chat/$package"
        echo "Linked @vex-chat/$package in ${target#$ROOT_DIR/}"
    done
done

echo "Local protocol linked from $PROTOCOL_DIR"
