#!/usr/bin/env bash
set -euo pipefail

UI_ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$UI_ROOT_DIR/scripts/generate-app-icons.sh"
