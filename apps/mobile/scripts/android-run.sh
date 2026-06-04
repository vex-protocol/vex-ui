#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ensure-java-home.sh
source "$SCRIPT_DIR/ensure-java-home.sh"
# shellcheck source=ensure-android-sdk.sh
source "$SCRIPT_DIR/ensure-android-sdk.sh"

ANDROID_EMULATOR_AVD="${ANDROID_EMULATOR_AVD:-vex_stable}"
LOCAL_SPIRE_PORT="${VEX_LOCAL_SPIRE_PORT:-16777}"

# Only force the emulator's Qt platform on Linux. macOS Qt builds use
# `cocoa`; pinning xcb there breaks the emulator UI / makes it hang
# silently.
case "$(uname -s)" in
  Linux) EMULATOR_QT_PLATFORM="${EMULATOR_QT_PLATFORM:-xcb}" ;;
  *)     EMULATOR_QT_PLATFORM="${EMULATOR_QT_PLATFORM:-}" ;;
esac

has_ready_device() {
  adb devices | awk 'NR > 1 && $2 == "device" { found=1 } END { exit(found ? 0 : 1) }'
}

emulator_avd_exists() {
  emulator -list-avds | awk -v avd="$ANDROID_EMULATOR_AVD" 'BEGIN { found=0 } $0==avd { found=1 } END { exit(found ? 0 : 1) }'
}

target_emulator_running() {
  local serial running_name
  while IFS= read -r serial; do
    [[ -z "$serial" ]] && continue
    running_name="$(adb -s "$serial" emu avd name 2>/dev/null | awk 'NR==1 { print $0 }' | tr -d '\r')"
    if [[ "$running_name" == "$ANDROID_EMULATOR_AVD" ]]; then
      return 0
    fi
  done < <(adb devices | awk '/^emulator-/ && $2 == "device" { print $1 }')
  return 1
}

# Pick a sensible reactNativeArchitectures default so we don't force
# `x86_64` on Apple Silicon hosts with arm64 phones (the prior default
# produced an APK with no matching ABI for those devices and made the
# build do extra work for nothing). Honor any explicit override.
detect_architectures_from_connected_devices() {
  local abi
  local -a serials=()
  local -a archs=()

  while IFS= read -r serial; do
    [[ -n "$serial" ]] && serials+=("$serial")
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

  if [[ ${#serials[@]} -eq 0 ]]; then
    case "$(uname -m)" in
      arm64|aarch64) echo "arm64-v8a" ;;
      *)             echo "x86_64" ;;
    esac
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
    case "$(uname -m)" in
      arm64|aarch64) echo "arm64-v8a" ;;
      *)             echo "x86_64" ;;
    esac
    return 0
  fi

  (IFS=,; echo "${archs[*]}")
}

if [[ -z "${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}" ]]; then
  export ORG_GRADLE_PROJECT_reactNativeArchitectures="$(detect_architectures_from_connected_devices)"
fi
echo "Using reactNativeArchitectures=${ORG_GRADLE_PROJECT_reactNativeArchitectures}"

run_emulator_async() {
  if [[ -n "$EMULATOR_QT_PLATFORM" ]]; then
    QT_QPA_PLATFORM="$EMULATOR_QT_PLATFORM" bash "$SCRIPT_DIR/start-android-emulator.sh" -- -avd "$ANDROID_EMULATOR_AVD" -no-snapshot-load -no-snapshot-save -no-boot-anim -gpu host >/tmp/vex-mobile-emulator.log 2>&1 &
  else
    bash "$SCRIPT_DIR/start-android-emulator.sh" -- -avd "$ANDROID_EMULATOR_AVD" -no-snapshot-load -no-snapshot-save -no-boot-anim -gpu host >/tmp/vex-mobile-emulator.log 2>&1 &
  fi
  echo $!
}

start_emulator_if_requested() {
  if [[ "${ANDROID_AUTO_START_EMULATOR:-1}" != "1" ]]; then
    return 0
  fi

  if ! emulator_avd_exists || target_emulator_running; then
    return 0
  fi

  echo "Starting emulator '${ANDROID_EMULATOR_AVD}'..."
  local emu_pid
  emu_pid="$(run_emulator_async)"

  for _ in $(seq 1 120); do
    if target_emulator_running; then
      return 0
    fi
    if ! kill -0 "$emu_pid" >/dev/null 2>&1; then
      echo "Emulator process exited before becoming ready." >&2
      echo "Last emulator log lines:" >&2
      awk 'NR>0{lines[NR%20]=$0} END{start=(NR>20?NR-19:1); for(i=start;i<=NR;i++) print lines[i%20]}' /tmp/vex-mobile-emulator.log >&2 || true
      exit 1
    fi
    sleep 2
  done

  echo "Emulator did not come online in time." >&2
  echo "Check /tmp/vex-mobile-emulator.log for details." >&2
  exit 1
}

start_emulator_if_needed() {
  start_emulator_if_requested
  if has_ready_device; then
    return 0
  fi

  echo "No connected Android devices found. Starting emulator '${ANDROID_EMULATOR_AVD}'..."
  local emu_pid
  emu_pid="$(run_emulator_async)"

  for _ in $(seq 1 120); do
    if has_ready_device; then
      return 0
    fi
    if ! kill -0 "$emu_pid" >/dev/null 2>&1; then
      echo "Emulator process exited before becoming ready." >&2
      echo "Last emulator log lines:" >&2
      awk 'NR>0{lines[NR%20]=$0} END{start=(NR>20?NR-19:1); for(i=start;i<=NR;i++) print lines[i%20]}' /tmp/vex-mobile-emulator.log >&2 || true
      exit 1
    fi
    sleep 2
  done

  echo "Emulator did not come online in time." >&2
  echo "Check /tmp/vex-mobile-emulator.log for details." >&2
  exit 1
}

start_emulator_if_needed

should_reverse_local_spire() {
  local server="${EXPO_PUBLIC_SERVER_URL:-}"
  if [[ "${VEX_ANDROID_REVERSE_SPIRE:-}" == "1" ]]; then
    return 0
  fi
  [[ "$server" =~ (^|//)(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|/|$) ]] && return 0
  [[ "$server" =~ ^(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|/|$) ]] && return 0
  return 1
}

if should_reverse_local_spire; then
  while IFS= read -r serial; do
    [[ -z "$serial" ]] && continue
    echo "[$serial] adb reverse tcp:${LOCAL_SPIRE_PORT}"
    adb -s "$serial" reverse "tcp:${LOCAL_SPIRE_PORT}" "tcp:${LOCAL_SPIRE_PORT}" >/dev/null 2>&1 || true
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
fi

exec expo run:android "$@"
