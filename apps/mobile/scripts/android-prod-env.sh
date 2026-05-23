#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export EXPO_PUBLIC_ENABLE_DEV_SERVER=0
export EXPO_PUBLIC_SERVER_URL=api.vex.wtf
export VEX_MOBILE_TARGET=production
export EAS_BUILD_PROFILE=production
export VEX_APP_DISPLAY_NAME="${VEX_APP_DISPLAY_NAME:-Vex Beta}"
export APP_PACKAGE=chat.vex.mobile

EXPECTED_ANDROID_PACKAGE="chat.vex.mobile"

cd "$ROOT_DIR"

if [[ -z "${VEX_ANDROID_GOOGLE_SERVICES_FILE:-}" ]]; then
  if [[ -f ./google-services.prod.json ]]; then
    export VEX_ANDROID_GOOGLE_SERVICES_FILE=./google-services.prod.json
  else
    export VEX_ANDROID_GOOGLE_SERVICES_FILE=./google-services.json
  fi
fi

validate_android_prod_google_services() {
  if [[ ! -f "$VEX_ANDROID_GOOGLE_SERVICES_FILE" ]]; then
    cat >&2 <<EOF
Missing $VEX_ANDROID_GOOGLE_SERVICES_FILE

Download Firebase google-services.json for Android package chat.vex.mobile
and save it at:

  apps/mobile/google-services.prod.json

or keep using the standard Firebase filename:

  apps/mobile/google-services.json

Then rerun the command.
EOF
    exit 1
  fi

  local google_services_package
  google_services_package="$(
    node -e '
      const fs = require("node:fs");
      const path = process.argv[1];
      const data = JSON.parse(fs.readFileSync(path, "utf8"));
      const clients = Array.isArray(data.client) ? data.client : [];
      const packageNames = clients
        .map((client) => client.client_info?.android_client_info?.package_name)
        .filter(Boolean);
      console.log(packageNames.join("\n"));
    ' "$VEX_ANDROID_GOOGLE_SERVICES_FILE"
  )"

  if ! grep -qx "$EXPECTED_ANDROID_PACKAGE" <<<"$google_services_package"; then
    cat >&2 <<EOF
$VEX_ANDROID_GOOGLE_SERVICES_FILE does not contain Android package $EXPECTED_ANDROID_PACKAGE.

Found package(s):
$google_services_package
EOF
    exit 1
  fi
}

validate_android_prod_prebuild() {
  if ! grep -q "applicationId '$EXPECTED_ANDROID_PACKAGE'" ./android/app/build.gradle; then
    cat >&2 <<EOF
Android prebuild did not generate applicationId '$EXPECTED_ANDROID_PACKAGE'.
Check VEX_MOBILE_TARGET and EAS_BUILD_PROFILE before running the prod build.
EOF
    exit 1
  fi
}

enable_installed_android_prod_packages() {
  if ! command -v adb >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r device; do
    if [[ -n "$device" ]]; then
      adb -s "$device" shell pm enable "$APP_PACKAGE" >/dev/null 2>&1 || true
    fi
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
}
