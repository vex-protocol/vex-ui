#!/usr/bin/env bash
# Clean development state: iOS simulators, spire DB, desktop keystore/data,
# then fresh pnpm install and pod install
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPIRE_DIR="$(cd "$REPO_ROOT/.." 2>/dev/null && pwd)/spire"
SPIRE_DB="$SPIRE_DIR/spire.sqlite"
TAURI_DATA="$HOME/Library/Application Support/com.vex-chat.app.dev"
TAURI_WEBVIEW="$HOME/Library/WebKit/com.vex-chat.app.dev/WebsiteData"
TAURI_LOGS="$HOME/Library/Logs/com.vex-chat.app.dev"

echo ""
echo -e "${YELLOW}=== Vex Dev Clean ===${NC}"
echo ""

# 1. iOS Simulators
echo -e "${YELLOW}[1/5] Erasing iOS simulators...${NC}"
if command -v xcrun &>/dev/null; then
  xcrun simctl shutdown all 2>/dev/null || true
  xcrun simctl erase all 2>/dev/null && \
    echo -e "${GREEN}  ✓ All iOS simulators erased${NC}" || \
    echo -e "${RED}  ✗ Failed to erase simulators${NC}"
else
  echo "  Skipped — Xcode CLI tools not found"
fi

# 2. Spire database
echo -e "${YELLOW}[2/5] Deleting spire database...${NC}"
if [ ! -d "$SPIRE_DIR" ]; then
  echo -e "${RED}  ✗ Spire repo not found at ../spire (expected $SPIRE_DIR)${NC}"
elif [ -f "$SPIRE_DB" ]; then
  rm -f "$SPIRE_DB" "${SPIRE_DB}-wal" "${SPIRE_DB}-shm" "${SPIRE_DB}-journal"
  echo -e "${GREEN}  ✓ Deleted $SPIRE_DB${NC}"
else
  echo "  Skipped — no database file at $SPIRE_DB"
fi

# 3. Development desktop app data + WebView storage (localStorage, IndexedDB)
echo -e "${YELLOW}[3/5] Clearing desktop app data...${NC}"
if [ -d "$TAURI_DATA" ]; then
  rm -rf "$TAURI_DATA"
  echo -e "${GREEN}  ✓ Deleted development app data ($TAURI_DATA)${NC}"
else
  echo "  Skipped — keystore not found"
fi
if [ -d "$TAURI_WEBVIEW" ]; then
  rm -rf "$TAURI_WEBVIEW"
  echo -e "${GREEN}  ✓ Deleted WebView data — localStorage, IndexedDB ($TAURI_WEBVIEW)${NC}"
else
  echo "  Skipped — WebView data not found"
fi
if [ -d "$TAURI_LOGS" ]; then
  rm -rf "$TAURI_LOGS"
  echo -e "${GREEN}  ✓ Deleted logs ($TAURI_LOGS)${NC}"
fi

# 4. Fresh pnpm install
echo -e "${YELLOW}[4/5] Fresh pnpm install...${NC}"
rm -rf "$REPO_ROOT/node_modules" "$REPO_ROOT"/apps/*/node_modules "$REPO_ROOT"/packages/*/node_modules
(cd "$REPO_ROOT" && pnpm install) && \
  echo -e "${GREEN}  ✓ pnpm install complete${NC}" || \
  echo -e "${RED}  ✗ pnpm install failed${NC}"

# 5. Fresh pod install
echo -e "${YELLOW}[5/5] Fresh pod install...${NC}"
if [ -d "$REPO_ROOT/apps/mobile/ios" ]; then
  rm -rf "$REPO_ROOT/apps/mobile/ios/Pods" "$REPO_ROOT/apps/mobile/ios/build"
  (cd "$REPO_ROOT/apps/mobile/ios" && pod install) && \
    echo -e "${GREEN}  ✓ pod install complete${NC}" || \
    echo -e "${RED}  ✗ pod install failed${NC}"
else
  echo "  Skipped — apps/mobile/ios not found"
fi

echo ""
echo -e "${GREEN}Done.${NC}"
echo ""
