#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ensure-java-home.sh
source "$SCRIPT_DIR/ensure-java-home.sh"
# shellcheck source=ensure-android-sdk.sh
source "$SCRIPT_DIR/ensure-android-sdk.sh"

# Runs Android app launch + multi-device log tail together.
# Usage:
#   pnpm -F mobile android:with-logs
# Optional:
#   LOG_FILTER='ReactNativeJS|vex-msg|vex-auth' pnpm -F mobile android:with-logs

LOG_SCRIPT="./scripts/logcat-all-devices.sh"
if [[ -z "${APP_PACKAGE:-}" ]]; then
    if [[ "${VEX_ENABLE_DEV_BUILD:-}" == "1" && "${EAS_BUILD_PROFILE:-}" == "development" ]]; then
        APP_PACKAGE="chat.vex.mobile.dev"
    else
        APP_PACKAGE="chat.vex.mobile"
    fi
fi
export APP_PACKAGE
APK_PATH="./android/app/build/outputs/apk/debug/app-debug.apk"
START_METRO="${START_METRO:-1}"
METRO_FORCE_RESTART="${METRO_FORCE_RESTART:-1}"
GRACEFUL_STOP=0

# Only force the emulator's Qt platform on Linux; macOS Qt builds use
# `cocoa`, and pinning xcb makes the emulator window hang invisibly.
case "$(uname -s)" in
  Linux) EMULATOR_QT_PLATFORM="${EMULATOR_QT_PLATFORM:-xcb}" ;;
  *)     EMULATOR_QT_PLATFORM="${EMULATOR_QT_PLATFORM:-}" ;;
esac

if [ ! -x "$LOG_SCRIPT" ]; then
    chmod +x "$LOG_SCRIPT"
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "adb not found in PATH."
    exit 1
fi

if ! command -v emulator >/dev/null 2>&1; then
    echo "emulator not found in PATH."
    exit 1
fi

detect_architectures_from_connected_devices() {
    local abi
    local -a serials=()
    local -a archs=()

    while IFS= read -r serial; do
        [[ -n "$serial" ]] && serials+=("$serial")
    done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

    if [[ ${#serials[@]} -eq 0 ]]; then
        echo "x86_64"
        return 0
    fi

    for serial in "${serials[@]}"; do
        abi="$(adb -s "$serial" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')"
        case "$abi" in
            arm64-v8a|armeabi-v7a|x86|x86_64)
                # macOS still ships bash 3.2, where `${archs[*]}` of an
                # empty array trips `set -u` ("unbound variable").
                # Guard the membership check by length so the first
                # element is always added without dereferencing the
                # empty array.
                if [[ ${#archs[@]} -eq 0 ]]; then
                    archs+=("$abi")
                elif [[ " ${archs[*]} " != *" ${abi} "* ]]; then
                    archs+=("$abi")
                fi
                ;;
        esac
    done

    if [[ ${#archs[@]} -eq 0 ]]; then
        # Default to the host arch so a Mac M-series user with no
        # adb-attached device still produces an installable APK on its
        # next adb-attach. arm64-v8a covers nearly every modern phone.
        echo "arm64-v8a"
        return 0
    fi

    (IFS=,; echo "${archs[*]}")
}

# Resolve which AVD this script should boot. Honor an explicit
# ANDROID_EMULATOR_AVD when it actually exists; otherwise prefer the
# project's `vex_stable` AVD (Linux dev box) and finally fall back to
# the first AVD listed by `emulator -list-avds` so a Mac with only
# Android Studio's default Pixel device still gets a working
# auto-boot. Caches the result on first call.
resolve_target_avd() {
    if [[ -n "${VEX_RESOLVED_AVD:-}" ]]; then
        echo "$VEX_RESOLVED_AVD"
        return 0
    fi
    local explicit="${ANDROID_EMULATOR_AVD:-}"
    local list
    list="$(emulator -list-avds 2>/dev/null || true)"
    local resolved=""
    if [[ -n "$explicit" ]] && awk -v target="$explicit" '$0==target { found=1 } END { exit(found ? 0 : 1) }' <<<"$list"; then
        resolved="$explicit"
    elif awk '$0=="vex_stable" { found=1 } END { exit(found ? 0 : 1) }' <<<"$list"; then
        resolved="vex_stable"
    else
        resolved="$(awk 'NR==1 { print $0; exit }' <<<"$list")"
    fi
    if [[ -z "$resolved" ]]; then
        return 1
    fi
    export VEX_RESOLVED_AVD="$resolved"
    echo "$resolved"
}

target_emulator_running() {
    local avd
    avd="$(resolve_target_avd 2>/dev/null || true)"
    [[ -z "$avd" ]] && return 1
    local serial running_name
    while IFS= read -r serial; do
        [[ -z "$serial" ]] && continue
        running_name="$(adb -s "$serial" emu avd name 2>/dev/null | awk 'NR==1 { print $0 }' | tr -d '\r')"
        if [[ "$running_name" == "$avd" ]]; then
            return 0
        fi
    done < <(adb devices | awk '/^emulator-/ && $2 == "device" { print $1 }')
    return 1
}

# Boot the project emulator alongside any already-attached physical
# device. The previous wiring would silently no-op when the
# hard-coded `vex_stable` AVD didn't exist on the host (i.e. every
# Mac), so a contributor running `android:multi` saw the script skip
# straight to "install on whatever's plugged in" instead of getting
# both targets up.
start_emulator_if_requested() {
    local emu_pid avd
    if [[ "${ANDROID_AUTO_START_EMULATOR:-1}" != "1" ]]; then
        return 0
    fi
    if ! avd="$(resolve_target_avd)"; then
        echo "No Android AVD found. Skipping emulator auto-start; create one in Android Studio Device Manager to enable it." >&2
        return 0
    fi
    if target_emulator_running; then
        echo "Emulator '${avd}' already running; reusing it."
        return 0
    fi

    echo "Starting emulator '${avd}'..."
    if [[ -n "$EMULATOR_QT_PLATFORM" ]]; then
        QT_QPA_PLATFORM="$EMULATOR_QT_PLATFORM" bash "$SCRIPT_DIR/start-android-emulator.sh" -- -avd "$avd" -no-snapshot-load -no-snapshot-save -no-boot-anim -gpu host >/tmp/vex-mobile-emulator.log 2>&1 &
    else
        bash "$SCRIPT_DIR/start-android-emulator.sh" -- -avd "$avd" -no-snapshot-load -no-snapshot-save -no-boot-anim -gpu host >/tmp/vex-mobile-emulator.log 2>&1 &
    fi
    emu_pid=$!
    for _ in $(seq 1 120); do
        if target_emulator_running; then
            return 0
        fi
        if ! kill -0 "$emu_pid" >/dev/null 2>&1; then
            echo "Emulator process exited before becoming ready." >&2
            echo "Check /tmp/vex-mobile-emulator.log for details." >&2
            exit 1
        fi
        sleep 2
    done
    echo "Emulator did not come online in time." >&2
    echo "Check /tmp/vex-mobile-emulator.log for details." >&2
    exit 1
}

cleanup() {
    trap - EXIT INT TERM
    if [ -n "${LOG_PID:-}" ] && kill -0 "$LOG_PID" >/dev/null 2>&1; then
        kill "$LOG_PID" >/dev/null 2>&1 || true
    fi
    # Final safety net for orphan per-device logcat readers.
    pkill -f "adb -s .* logcat -v time" >/dev/null 2>&1 || true
    if [ -n "${METRO_PID:-}" ] && kill -0 "$METRO_PID" >/dev/null 2>&1; then
        kill "$METRO_PID" >/dev/null 2>&1 || true
    fi
}
on_interrupt() {
    GRACEFUL_STOP=1
    cleanup
    exit 0
}
trap cleanup EXIT
trap on_interrupt INT TERM

start_emulator_if_requested

if [[ -z "${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}" ]]; then
    export ORG_GRADLE_PROJECT_reactNativeArchitectures="$(detect_architectures_from_connected_devices)"
fi
echo "Using reactNativeArchitectures=${ORG_GRADLE_PROJECT_reactNativeArchitectures}"
echo "Using Android package ${APP_PACKAGE}"

echo "Starting multi-device logs..."
bash "$LOG_SCRIPT" &
LOG_PID=$!

# Wait for the emulator to finish booting (sys.boot_completed=1)
# before we try to install on it. The gradle build below usually
# masks this race, but on cold boots it can still beat the device to
# `pm install`, surfacing as a confusing "device offline" error.
wait_for_target_emulator_boot() {
    local avd serial
    avd="$(resolve_target_avd 2>/dev/null || true)"
    [[ -z "$avd" ]] && return 0
    while IFS= read -r serial; do
        [[ -z "$serial" ]] && continue
        local running_name
        running_name="$(adb -s "$serial" emu avd name 2>/dev/null | awk 'NR==1 { print $0 }' | tr -d '\r')"
        [[ "$running_name" != "$avd" ]] && continue
        echo "Waiting for emulator '${avd}' (${serial}) to finish booting..."
        for _ in $(seq 1 90); do
            if [[ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
                return 0
            fi
            sleep 2
        done
        echo "Emulator did not finish booting in time; continuing anyway." >&2
        return 0
    done < <(adb devices | awk '/^emulator-/ && $2 == "device" { print $1 }')
}

wait_for_target_emulator_boot

echo "Building debug APK..."
pnpm run android:clean-autolinking
(
    cd android
    ./gradlew --console=plain app:assembleDebug
)

if [ ! -f "$APK_PATH" ]; then
    echo "Debug APK not found at: $APK_PATH"
    exit 1
fi

DEVICES=()
while IFS= read -r serial; do
    if [ -n "$serial" ]; then
        DEVICES+=("$serial")
    fi
done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [ "${#DEVICES[@]}" -eq 0 ]; then
    echo "No connected Android devices/emulators found."
    exit 1
fi

if [ "$START_METRO" = "1" ]; then
    if [ "$METRO_FORCE_RESTART" = "1" ]; then
        OLD_METRO_PIDS="$(lsof -ti tcp:8081 -sTCP:LISTEN || true)"
        if [ -n "$OLD_METRO_PIDS" ]; then
            echo "Stopping existing process(es) on tcp:8081: $OLD_METRO_PIDS"
            for pid in $OLD_METRO_PIDS; do
                kill "$pid" >/dev/null 2>&1 || true
            done
            sleep 1
        fi
    fi
    echo "Starting Metro dev server on tcp:8081..."
    EXPO_NO_INTERACTIVE=1 pnpm exec expo start --dev-client --port 8081 --host lan >/tmp/vex-mobile-metro.log 2>&1 &
    METRO_PID=$!
    for _ in $(seq 1 25); do
        if lsof -ti tcp:8081 >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! lsof -ti tcp:8081 >/dev/null 2>&1; then
        echo "Metro did not start on tcp:8081."
        echo "Check /tmp/vex-mobile-metro.log for details."
        exit 1
    fi
    echo "Metro ready on tcp:8081 (logs: /tmp/vex-mobile-metro.log)."
fi

echo "Installing and launching on ${#DEVICES[@]} device(s)..."
for serial in "${DEVICES[@]}"; do
    echo "[$serial] adb reverse tcp:8081"
    adb -s "$serial" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
    echo "[$serial] install"
    adb -s "$serial" install -r -d "$APK_PATH" >/dev/null
    echo "[$serial] launch"
    adb -s "$serial" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
done

echo
echo "Android install/launch completed on all connected devices. Keeping logs attached."
echo "Press Ctrl+C to stop log streaming."
wait "$LOG_PID"
