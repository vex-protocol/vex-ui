#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
ARCHIVE_ROOT="${VEX_IOS_ARCHIVE_ROOT:-$IOS_DIR/build/TestFlight}"
BUILD_NUMBER="${VEX_IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
BUNDLE_ID="${VEX_IOS_BUNDLE_IDENTIFIER:-com.ender.vex}"
TEAM_ID="${VEX_IOS_APPLE_TEAM_ID:-}"
ARCHIVE_PATH="$ARCHIVE_ROOT/Vex-$BUILD_NUMBER.xcarchive"
EXPORT_PATH="$ARCHIVE_ROOT/export-$BUILD_NUMBER"
EXPORT_OPTIONS_PLIST="$ARCHIVE_ROOT/ExportOptions-$BUILD_NUMBER.plist"
SKIP_UPLOAD="${VEX_IOS_SKIP_UPLOAD:-0}"

if [[ "${1:-}" == "--skip-upload" ]]; then
  SKIP_UPLOAD="1"
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not available. Install Xcode first."
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is not available. Install Xcode command line tools first."
  exit 1
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "pod is not available. Install CocoaPods first."
  exit 1
fi

if [[ -z "$TEAM_ID" ]]; then
  EXISTING_PROJECT="$(
    find "$IOS_DIR" -maxdepth 2 -name project.pbxproj -print -quit 2>/dev/null || true
  )"
fi

if [[ -z "$TEAM_ID" && -n "${EXISTING_PROJECT:-}" ]]; then
  TEAM_ID="$(
    /usr/bin/grep -m 1 "DEVELOPMENT_TEAM =" "$EXISTING_PROJECT" \
      | /usr/bin/sed -E 's/.*DEVELOPMENT_TEAM = ([A-Z0-9]+);.*/\1/' \
      || true
  )"
fi

export EXPO_NO_TELEMETRY="${EXPO_NO_TELEMETRY:-1}"
export VEX_IOS_BUNDLE_IDENTIFIER="$BUNDLE_ID"
export VEX_IOS_BUILD_NUMBER="$BUILD_NUMBER"
if [[ -n "$TEAM_ID" ]]; then
  export VEX_IOS_APPLE_TEAM_ID="$TEAM_ID"
fi

echo "Preparing iOS TestFlight build"
echo "Bundle identifier: $BUNDLE_ID"
echo "Build number: $BUILD_NUMBER"
if [[ -n "$TEAM_ID" ]]; then
  echo "Apple team ID: $TEAM_ID"
else
  echo "Apple team ID: letting Xcode choose from configured accounts"
fi

cd "$ROOT_DIR"
pnpm exec expo prebuild --platform ios --clean --no-install

if [[ ! -d "$IOS_DIR" ]]; then
  echo "Expo prebuild did not generate $IOS_DIR"
  exit 1
fi

cd "$IOS_DIR"
pod install --silent

if [[ ! -d "Vex.xcworkspace" ]]; then
  echo "Expected workspace was not generated: $IOS_DIR/Vex.xcworkspace"
  exit 1
fi

mkdir -p "$ARCHIVE_ROOT" "$EXPORT_PATH"

AUTH_ARGS=()
if [[ -n "${VEX_ASC_API_KEY_PATH:-}" || -n "${VEX_ASC_API_KEY_ID:-}" || -n "${VEX_ASC_API_ISSUER_ID:-}" ]]; then
  if [[ -z "${VEX_ASC_API_KEY_PATH:-}" || -z "${VEX_ASC_API_KEY_ID:-}" || -z "${VEX_ASC_API_ISSUER_ID:-}" ]]; then
    echo "Set VEX_ASC_API_KEY_PATH, VEX_ASC_API_KEY_ID, and VEX_ASC_API_ISSUER_ID together."
    exit 1
  fi
  AUTH_ARGS=(
    -authenticationKeyPath "$VEX_ASC_API_KEY_PATH"
    -authenticationKeyID "$VEX_ASC_API_KEY_ID"
    -authenticationKeyIssuerID "$VEX_ASC_API_ISSUER_ID"
  )
fi

TEAM_BUILD_SETTINGS=()
if [[ -n "$TEAM_ID" ]]; then
  TEAM_BUILD_SETTINGS=(DEVELOPMENT_TEAM="$TEAM_ID")
fi

XCODEBUILD_LOGGING=()
if [[ "${VEX_XCODEBUILD_VERBOSE:-0}" != "1" ]]; then
  XCODEBUILD_LOGGING=(-quiet)
fi

echo "Archiving with Xcode..."
if ! xcodebuild \
  ${XCODEBUILD_LOGGING[@]+"${XCODEBUILD_LOGGING[@]}"} \
  -workspace Vex.xcworkspace \
  -scheme Vex \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} \
  CODE_SIGN_STYLE=Automatic \
  ${TEAM_BUILD_SETTINGS[@]+"${TEAM_BUILD_SETTINGS[@]}"} \
  archive; then
  echo "Xcode archive failed."
  echo "Open $IOS_DIR/Vex.xcworkspace in Xcode for account or signing prompts, then rerun this script."
  exit 1
fi

if [[ "$SKIP_UPLOAD" == "1" ]]; then
  echo "Archive complete: $ARCHIVE_PATH"
  exit 0
fi

cat > "$EXPORT_OPTIONS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>destination</key>
    <string>upload</string>
    <key>distributionBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>manageAppVersionAndBuildNumber</key>
    <false/>
    <key>method</key>
    <string>app-store-connect</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>uploadSymbols</key>
    <true/>
PLIST

if [[ -n "$TEAM_ID" ]]; then
  cat >> "$EXPORT_OPTIONS_PLIST" <<PLIST
    <key>teamID</key>
    <string>$TEAM_ID</string>
PLIST
fi

cat >> "$EXPORT_OPTIONS_PLIST" <<PLIST
</dict>
</plist>
PLIST

echo "Uploading archive to App Store Connect..."
if ! xcodebuild \
  ${XCODEBUILD_LOGGING[@]+"${XCODEBUILD_LOGGING[@]}"} \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -allowProvisioningUpdates \
  ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"}; then
  echo "Xcode upload failed."
  echo "Make sure Xcode has an Apple account with App Store Connect access for team $TEAM_ID."
  echo "Alternatively, rerun with VEX_ASC_API_KEY_PATH, VEX_ASC_API_KEY_ID, and VEX_ASC_API_ISSUER_ID set."
  echo "Archive kept at: $ARCHIVE_PATH"
  exit 1
fi

echo "Upload complete. App Store Connect may take several minutes before the build appears in TestFlight."
