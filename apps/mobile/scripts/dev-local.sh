#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export EXPO_PUBLIC_ENABLE_DEV_SERVER=1
export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-${VEX_LOCAL_SPIRE_HOST:-localhost:16777}}"
export EXPO_PUBLIC_DEV_API_KEY="${EXPO_PUBLIC_DEV_API_KEY:-local-dev}"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

cd "$ROOT_DIR"

echo "Starting Expo dev client against ${EXPO_PUBLIC_SERVER_URL} with dev API key enabled."
exec expo start --dev-client "$@"
