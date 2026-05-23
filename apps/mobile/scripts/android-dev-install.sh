#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ensure-java-home.sh
source "$SCRIPT_DIR/ensure-java-home.sh"
# shellcheck source=ensure-android-sdk.sh
source "$SCRIPT_DIR/ensure-android-sdk.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APK_PATH="$ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk"

export EXPO_PUBLIC_ENABLE_DEV_SERVER=1
export EXPO_PUBLIC_SERVER_URL=dev.vex.wtf
export VEX_MOBILE_TARGET=development
export EAS_BUILD_PROFILE=development
export APP_PACKAGE=chat.vex.mobile.dev

EXPECTED_ANDROID_PACKAGE="chat.vex.mobile.dev"

cd "$ROOT_DIR"

if [[ -z "${VEX_ANDROID_GOOGLE_SERVICES_FILE:-}" ]]; then
  if [[ -f ./google-services.dev.json ]]; then
    export VEX_ANDROID_GOOGLE_SERVICES_FILE=./google-services.dev.json
  else
    export VEX_ANDROID_GOOGLE_SERVICES_FILE=./google-services.staging.json
  fi
fi

detect_architectures_from_connected_devices() {
  local abi
  local -a serials=()
  local -a archs=()

  while IFS= read -r serial; do
    [[ -n "$serial" ]] && serials+=("$serial")
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

  if [[ ${#serials[@]} -eq 0 ]]; then
    echo "arm64-v8a"
    return 0
  fi

  for serial in "${serials[@]}"; do
    abi="$(adb -s "$serial" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')"
    case "$abi" in
      arm64-v8a|armeabi-v7a|x86|x86_64)
        if [[ ${#archs[@]} -eq 0 ]]; then
          archs+=("$abi")
        elif [[ " ${archs[*]} " != *" ${abi} "* ]]; then
          archs+=("$abi")
        fi
        ;;
    esac
  done

  if [[ ${#archs[@]} -eq 0 ]]; then
    echo "arm64-v8a"
    return 0
  fi

  (IFS=,; echo "${archs[*]}")
}

if [[ ! -f "$VEX_ANDROID_GOOGLE_SERVICES_FILE" ]]; then
  cat >&2 <<EOF
Missing $VEX_ANDROID_GOOGLE_SERVICES_FILE

Download Firebase google-services.json for Android package chat.vex.mobile.dev
and save it at:

  apps/mobile/google-services.dev.json

or keep using the existing staging filename:

  apps/mobile/google-services.staging.json

Then rerun:

  pnpm android:dev:install
EOF
  exit 1
fi

GOOGLE_SERVICES_PACKAGE="$(
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

if ! grep -qx "$EXPECTED_ANDROID_PACKAGE" <<<"$GOOGLE_SERVICES_PACKAGE"; then
  cat >&2 <<EOF
$VEX_ANDROID_GOOGLE_SERVICES_FILE does not contain Android package $EXPECTED_ANDROID_PACKAGE.

Found package(s):
$GOOGLE_SERVICES_PACKAGE
EOF
  exit 1
fi

echo "Prebuilding Android dev flavor..."
pnpm exec expo prebuild --clean --platform android

if ! grep -q "applicationId '$EXPECTED_ANDROID_PACKAGE'" ./android/app/build.gradle; then
  cat >&2 <<EOF
Android prebuild did not generate applicationId '$EXPECTED_ANDROID_PACKAGE'.
Check VEX_MOBILE_TARGET and EAS_BUILD_PROFILE before running the development install.
EOF
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed or not on PATH."
  exit 1
fi

if [[ -z "${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}" ]]; then
  export ORG_GRADLE_PROJECT_reactNativeArchitectures="$(detect_architectures_from_connected_devices)"
fi
echo "Using reactNativeArchitectures=${ORG_GRADLE_PROJECT_reactNativeArchitectures}"

echo "Building development release APK with bundled JS..."
(
  cd "$ROOT_DIR/android"
  ./gradlew assembleRelease
)

if [[ ! -f "$APK_PATH" ]]; then
  echo "Release APK not found at: $APK_PATH"
  exit 1
fi

DEVICES=()
while IFS= read -r device; do
  if [[ -n "$device" ]]; then
    DEVICES+=("$device")
  fi
done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [[ ${#DEVICES[@]} -eq 0 ]]; then
  echo "No connected Android devices found via adb."
  exit 1
fi

for device in "${DEVICES[@]}"; do
  echo "Installing on $device..."
  adb -s "$device" install -r "$APK_PATH"
  adb -s "$device" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
done

echo "Installed Vex Developer APK on ${#DEVICES[@]} device(s)."
