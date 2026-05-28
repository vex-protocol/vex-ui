#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"

usage() {
  cat >&2 <<EOF
Usage:
  ios-install.sh development [device-udid]
  ios-install.sh production [device-udid]

The device UDID may also be supplied with IOS_DEVICE_ID.
EOF
  exit 1
}

FLAVOR="${1:-}"
if [[ "$FLAVOR" != "development" && "$FLAVOR" != "production" ]]; then
  usage
fi
shift || true

# pnpm sometimes forwards a literal "--" before user args.
if [[ "${1:-}" == "--" ]]; then
  shift
fi

DEVICE_ID="${1:-${IOS_DEVICE_ID:-}}"
IOS_DEVELOPMENT_TEAM="${IOS_DEVELOPMENT_TEAM:-UBG5MM55LT}"
COMMIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo local)"
SHORT_SHA="${COMMIT_SHA:0:8}"
PREBUILD_TOUCHED=0
WORKSPACE_PATH=""
PROJECT_FILE=""
INFO_PLIST=""
ENTITLEMENTS_PATH=""
SCHEME_NAME=""

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed or not on PATH."
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not installed or not on PATH."
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is not installed or not on PATH."
  exit 1
fi

VEX_APP_VERSION="$(node "$ROOT_DIR/scripts/resolve-mobile-version.cjs")"
export VEX_APP_VERSION
export EXPO_PUBLIC_VEX_APP_VERSION="${EXPO_PUBLIC_VEX_APP_VERSION:-$VEX_APP_VERSION}"
export EXPO_PUBLIC_VEX_COMMIT_SHA="${EXPO_PUBLIC_VEX_COMMIT_SHA:-$COMMIT_SHA}"

if [[ "$FLAVOR" == "development" ]]; then
  export EAS_BUILD_PROFILE=development
  export VEX_APP_ENV=development
  export VEX_ENABLE_DEV_BUILD=1
  export VEX_APP_DISPLAY_NAME="${VEX_APP_DISPLAY_NAME:-Vex Development}"
  export VEX_IOS_BUNDLE_IDENTIFIER="${VEX_IOS_BUNDLE_IDENTIFIER:-chat.vex.mobile.dev}"
  export VEX_PASSKEY_RP_HOST="${VEX_PASSKEY_RP_HOST:-dev.vex.wtf}"
  export VEX_IOS_ASSOCIATED_DOMAIN_MODE="${VEX_IOS_ASSOCIATED_DOMAIN_MODE:-developer}"
  export EXPO_PUBLIC_ENABLE_DEV_SERVER="${EXPO_PUBLIC_ENABLE_DEV_SERVER:-1}"
  export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-dev.vex.wtf}"
  export EXPO_PUBLIC_VEX_BUILD_LABEL="${EXPO_PUBLIC_VEX_BUILD_LABEL:-${VEX_APP_VERSION}RC-${SHORT_SHA}}"
  DERIVED_DATA_PATH="$ROOT_DIR/ios/build-install-development"
  EXPECTED_BUNDLE_ID="chat.vex.mobile.dev"
  EXPECTED_DISPLAY_NAME="Vex Development"
  EXPECTED_ASSOCIATED_DOMAIN="webcredentials:dev.vex.wtf?mode=developer"
else
  export EAS_BUILD_PROFILE=production
  export VEX_APP_ENV=production
  export VEX_ENABLE_DEV_BUILD=0
  export VEX_APP_DISPLAY_NAME="${VEX_APP_DISPLAY_NAME:-Vex}"
  export VEX_IOS_BUNDLE_IDENTIFIER="${VEX_IOS_BUNDLE_IDENTIFIER:-chat.vex.mobile}"
  export VEX_PASSKEY_RP_HOST="${VEX_PASSKEY_RP_HOST:-api.vex.wtf}"
  export VEX_IOS_ASSOCIATED_DOMAIN_MODE="${VEX_IOS_ASSOCIATED_DOMAIN_MODE:-developer}"
  export EXPO_PUBLIC_ENABLE_DEV_SERVER="${EXPO_PUBLIC_ENABLE_DEV_SERVER:-0}"
  export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-api.vex.wtf}"
  export EXPO_PUBLIC_VEX_BUILD_LABEL="${EXPO_PUBLIC_VEX_BUILD_LABEL:-${VEX_APP_VERSION}-${SHORT_SHA}}"
  DERIVED_DATA_PATH="$ROOT_DIR/ios/build-install-production"
  EXPECTED_BUNDLE_ID="chat.vex.mobile"
  EXPECTED_DISPLAY_NAME="Vex"
  if [[ "$VEX_IOS_ASSOCIATED_DOMAIN_MODE" == "developer" ]]; then
    EXPECTED_ASSOCIATED_DOMAIN="webcredentials:api.vex.wtf?mode=developer"
  else
    EXPECTED_ASSOCIATED_DOMAIN="webcredentials:api.vex.wtf"
  fi
fi

restore_prod_prebuild() {
  local status=$?
  if [[ "$PREBUILD_TOUCHED" == "1" && "${IOS_KEEP_FLAVOR_PREBUILD:-0}" != "1" ]] && { [[ "$FLAVOR" == "development" ]] || [[ "${VEX_IOS_ASSOCIATED_DOMAIN_MODE:-}" == "developer" ]]; }; then
    set +e
    echo "Restoring generated iOS project to production defaults..."
    (
      cd "$ROOT_DIR"
      EAS_BUILD_PROFILE=production \
      VEX_APP_ENV=production \
      VEX_ENABLE_DEV_BUILD=0 \
      VEX_APP_DISPLAY_NAME=Vex \
      VEX_APP_VERSION="$VEX_APP_VERSION" \
      VEX_IOS_BUNDLE_IDENTIFIER=chat.vex.mobile \
      VEX_PASSKEY_RP_HOST=api.vex.wtf \
      VEX_IOS_ASSOCIATED_DOMAIN_MODE=normal \
      EXPO_PUBLIC_ENABLE_DEV_SERVER=0 \
      EXPO_PUBLIC_SERVER_URL=api.vex.wtf \
      EXPO_PUBLIC_VEX_APP_VERSION="$VEX_APP_VERSION" \
      EXPO_PUBLIC_VEX_COMMIT_SHA="$COMMIT_SHA" \
      pnpm exec expo prebuild --clean --platform ios --no-install >/dev/null
    )
  fi
  exit "$status"
}

trap restore_prod_prebuild EXIT

detect_ios_device() {
  local candidates
  candidates="$(
    xcrun xctrace list devices 2>/dev/null |
      sed -n 's/.*(\([0-9A-Fa-f-]\{20,\}\)).*/\1/p' |
      grep -v '^dvtdevice-' || true
  )"

  if [[ -z "$candidates" ]]; then
    return 1
  fi

  echo "${candidates%%$'\n'*}"
}

read_plist_value() {
  local plist_path="$1"
  local key="$2"
  plutil -extract "$key" raw "$plist_path" 2>/dev/null || true
}

read_associated_domain() {
  /usr/libexec/PlistBuddy -c "Print :com.apple.developer.associated-domains:0" "$ENTITLEMENTS_PATH" 2>/dev/null || true
}

resolve_ios_project_paths() {
  WORKSPACE_PATH="$(
    find "$ROOT_DIR/ios" -maxdepth 1 -type d -name '*.xcworkspace' |
      grep -v '/Pods.xcworkspace$' |
      sort |
      head -n 1 || true
  )"
  PROJECT_FILE="$(
    find "$ROOT_DIR/ios" -maxdepth 2 -type f -path '*.xcodeproj/project.pbxproj' |
      grep -v '/Pods.xcodeproj/' |
      sort |
      head -n 1 || true
  )"
  INFO_PLIST="$(
    find "$ROOT_DIR/ios" -maxdepth 2 -type f -name Info.plist |
      grep -v '/Pods/' |
      sort |
      head -n 1 || true
  )"
  ENTITLEMENTS_PATH="$(
    find "$ROOT_DIR/ios" -maxdepth 2 -type f -name '*.entitlements' |
      grep -v '/Pods/' |
      sort |
      head -n 1 || true
  )"

  if [[ -z "$WORKSPACE_PATH" || -z "$PROJECT_FILE" || -z "$INFO_PLIST" || -z "$ENTITLEMENTS_PATH" ]]; then
    cat >&2 <<EOF
iOS prebuild did not generate the expected workspace, project, plist, and entitlements files.
EOF
    exit 1
  fi

  SCHEME_NAME="${IOS_SCHEME_NAME:-$(basename "$WORKSPACE_PATH" .xcworkspace)}"
}

validate_ios_prebuild() {
  local display_name
  local associated_domain

  display_name="$(read_plist_value "$INFO_PLIST" CFBundleDisplayName)"
  associated_domain="$(read_associated_domain)"

  if ! grep -Eq "PRODUCT_BUNDLE_IDENTIFIER = \"?${EXPECTED_BUNDLE_ID//./\\.}\"?;" "$PROJECT_FILE"; then
    cat >&2 <<EOF
iOS prebuild did not generate bundle id $EXPECTED_BUNDLE_ID.
Check VEX_ENABLE_DEV_BUILD, VEX_APP_ENV, and EAS_BUILD_PROFILE.
EOF
    exit 1
  fi

  if [[ "$display_name" != "$EXPECTED_DISPLAY_NAME" ]]; then
    cat >&2 <<EOF
iOS prebuild generated display name "$display_name"; expected "$EXPECTED_DISPLAY_NAME".
EOF
    exit 1
  fi

  if [[ "$associated_domain" != "$EXPECTED_ASSOCIATED_DOMAIN" ]]; then
    cat >&2 <<EOF
iOS prebuild generated associated domain "$associated_domain"; expected "$EXPECTED_ASSOCIATED_DOMAIN".
EOF
    exit 1
  fi
}

find_built_app() {
  local products_dir="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos"
  local app_path
  local bundle_id

  if [[ ! -d "$products_dir" ]]; then
    return 1
  fi

  while IFS= read -r app_path; do
    bundle_id="$(read_plist_value "$app_path/Info.plist" CFBundleIdentifier)"
    if [[ "$bundle_id" == "$EXPECTED_BUNDLE_ID" ]]; then
      echo "$app_path"
      return 0
    fi
  done < <(find "$products_dir" -maxdepth 1 -type d -name '*.app' | sort)

  return 1
}

cd "$ROOT_DIR"

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(detect_ios_device || true)"
fi

if [[ -z "$DEVICE_ID" ]]; then
  cat >&2 <<EOF
No connected iOS device found.

Plug in the device, unlock it, trust this Mac, then rerun:

  pnpm ios:$([[ "$FLAVOR" == "development" ]] && echo dev || echo prod):install

Or pass the UDID explicitly:

  IOS_DEVICE_ID=<udid> pnpm ios:$([[ "$FLAVOR" == "development" ]] && echo dev || echo prod):install
EOF
  exit 1
fi

echo "Prebuilding iOS $FLAVOR flavor..."
PREBUILD_TOUCHED=1
pnpm exec expo prebuild --clean --platform ios
resolve_ios_project_paths
validate_ios_prebuild

echo "Building $EXPECTED_DISPLAY_NAME for iOS device $DEVICE_ID..."
xcodebuild \
  -workspace "$WORKSPACE_PATH" \
  -scheme "$SCHEME_NAME" \
  -configuration Release \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$IOS_DEVELOPMENT_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP_PATH="$(find_built_app || true)"

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Built .app for bundle id $EXPECTED_BUNDLE_ID not found under $DERIVED_DATA_PATH."
  exit 1
fi

echo "Installing $APP_PATH on $DEVICE_ID..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

if [[ "${IOS_LAUNCH:-0}" == "1" ]]; then
  xcrun devicectl device process launch --device "$DEVICE_ID" "$EXPECTED_BUNDLE_ID" >/dev/null 2>&1 || true
fi

echo "Installed $EXPECTED_DISPLAY_NAME ($EXPECTED_BUNDLE_ID) $EXPO_PUBLIC_VEX_BUILD_LABEL on $DEVICE_ID."
