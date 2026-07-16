#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_SVG="$ROOT_DIR/assets/vex_icon.svg"
MOBILE_ASSETS_DIR="$ROOT_DIR/apps/mobile/assets"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
DESKTOP_PROD_DIR="$DESKTOP_DIR/src-tauri/icons"
DESKTOP_DEV_DIR="$DESKTOP_DIR/src-tauri/icons-development"

CANVAS_SIZE="1024x1024"
BACKGROUND_COLOR="#0a0a0a"
PRODUCTION_COLOR="#e70000"
DEVELOPMENT_COLOR="#a8c8df"
MOBILE_MARK_SIZE="640x640"
IOS_MARK_SIZE="700x700"
ANDROID_MARK_SIZE="540x540"
DESKTOP_MARK_SIZE="570x570"

if ! command -v magick >/dev/null 2>&1; then
    echo "ImageMagick is required to regenerate app icons." >&2
    exit 1
fi
if [ ! -f "$SOURCE_SVG" ]; then
    echo "Source SVG not found: $SOURCE_SVG" >&2
    exit 1
fi

mkdir -p "$MOBILE_ASSETS_DIR" "$DESKTOP_PROD_DIR" "$DESKTOP_DEV_DIR"
cp "$SOURCE_SVG" "$MOBILE_ASSETS_DIR/app-icon.svg"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DEV_SVG="$TMP_DIR/vex-icon-development.svg"
sed "s/#E70000/$DEVELOPMENT_COLOR/g; s/#e70000/$DEVELOPMENT_COLOR/g" \
    "$SOURCE_SVG" > "$DEV_SVG"

render_mark() {
    local source="$1"
    local size="$2"
    local output="$3"
    magick -background none \
        "$source" \
        -alpha on \
        -strip \
        -resize "$size" \
        +repage \
        "PNG32:$output"
}

render_mobile_icon() {
    local mark="$1"
    local output="$2"
    magick -size "$CANVAS_SIZE" "xc:$BACKGROUND_COLOR" \
        "$mark" \
        -gravity center \
        -compose over \
        -composite \
        -alpha remove \
        -strip \
        "PNG24:$output"
}

render_android_foreground() {
    local mark="$1"
    local output="$2"
    magick -size "$CANVAS_SIZE" xc:none \
        "$mark" \
        -gravity center \
        -compose over \
        -composite \
        -strip \
        "PNG32:$output"
}

render_desktop_source() {
    local mark="$1"
    local output="$2"
    magick -size "$CANVAS_SIZE" xc:none \
        -fill "$BACKGROUND_COLOR" \
        -draw "roundrectangle 100,100 924,924 180,180" \
        "$mark" \
        -gravity center \
        -compose over \
        -composite \
        -strip \
        "PNG32:$output"
}

normalize_macos_icon() {
    local icon="$1"
    local name="$2"
    if ! command -v iconutil >/dev/null 2>&1; then
        return
    fi

    local iconset="$TMP_DIR/$name.iconset"
    local normalized="$TMP_DIR/$name.icns"
    iconutil --convert iconset "$icon" --output "$iconset"
    iconutil --convert icns "$iconset" --output "$normalized"
    mv "$normalized" "$icon"
}

PROD_MOBILE_MARK="$TMP_DIR/production-mobile-mark.png"
DEV_MOBILE_MARK="$TMP_DIR/development-mobile-mark.png"
PROD_IOS_MARK="$TMP_DIR/production-ios-mark.png"
DEV_IOS_MARK="$TMP_DIR/development-ios-mark.png"
PROD_ANDROID_MARK="$TMP_DIR/production-android-mark.png"
DEV_ANDROID_MARK="$TMP_DIR/development-android-mark.png"
PROD_DESKTOP_MARK="$TMP_DIR/production-desktop-mark.png"
DEV_DESKTOP_MARK="$TMP_DIR/development-desktop-mark.png"
PROD_DESKTOP_SOURCE="$TMP_DIR/production-desktop-icon.png"
DEV_DESKTOP_SOURCE="$TMP_DIR/development-desktop-icon.png"

render_mark "$SOURCE_SVG" "$MOBILE_MARK_SIZE" "$PROD_MOBILE_MARK"
render_mark "$DEV_SVG" "$MOBILE_MARK_SIZE" "$DEV_MOBILE_MARK"
render_mark "$SOURCE_SVG" "$IOS_MARK_SIZE" "$PROD_IOS_MARK"
render_mark "$DEV_SVG" "$IOS_MARK_SIZE" "$DEV_IOS_MARK"
render_mark "$SOURCE_SVG" "$ANDROID_MARK_SIZE" "$PROD_ANDROID_MARK"
render_mark "$DEV_SVG" "$ANDROID_MARK_SIZE" "$DEV_ANDROID_MARK"
render_mark "$SOURCE_SVG" "$DESKTOP_MARK_SIZE" "$PROD_DESKTOP_MARK"
render_mark "$DEV_SVG" "$DESKTOP_MARK_SIZE" "$DEV_DESKTOP_MARK"

render_mobile_icon "$PROD_MOBILE_MARK" "$MOBILE_ASSETS_DIR/icon-prod.png"
render_mobile_icon "$DEV_MOBILE_MARK" "$MOBILE_ASSETS_DIR/icon-dev.png"
render_mobile_icon "$PROD_IOS_MARK" "$MOBILE_ASSETS_DIR/icon-prod-ios.png"
render_mobile_icon "$DEV_IOS_MARK" "$MOBILE_ASSETS_DIR/icon-dev-ios.png"
render_android_foreground \
    "$PROD_ANDROID_MARK" \
    "$MOBILE_ASSETS_DIR/icon-prod-android.png"
render_android_foreground \
    "$DEV_ANDROID_MARK" \
    "$MOBILE_ASSETS_DIR/icon-dev-android.png"

render_desktop_source "$PROD_DESKTOP_MARK" "$PROD_DESKTOP_SOURCE"
render_desktop_source "$DEV_DESKTOP_MARK" "$DEV_DESKTOP_SOURCE"

pnpm --dir "$DESKTOP_DIR" exec tauri icon \
    "$PROD_DESKTOP_SOURCE" \
    --output "$DESKTOP_PROD_DIR"
pnpm --dir "$DESKTOP_DIR" exec tauri icon \
    "$DEV_DESKTOP_SOURCE" \
    --output "$DESKTOP_DEV_DIR"

# Tauri's ICNS encoder can produce bytewise-different containers for identical
# pixels. macOS iconutil rewrites them deterministically, avoiding noisy diffs.
normalize_macos_icon "$DESKTOP_PROD_DIR/icon.icns" "production"
normalize_macos_icon "$DESKTOP_DEV_DIR/icon.icns" "development"

# Tauri emits mobile launchers too; Expo owns those from the dedicated assets
# above, so keep the desktop icon directories focused on bundle resources.
rm -rf \
    "$DESKTOP_PROD_DIR/android" \
    "$DESKTOP_PROD_DIR/ios" \
    "$DESKTOP_DEV_DIR/android" \
    "$DESKTOP_DEV_DIR/ios"

echo "Regenerated Vex app icons from: $SOURCE_SVG"
echo "Production mark: $PRODUCTION_COLOR"
echo "Development mark: $DEVELOPMENT_COLOR"
