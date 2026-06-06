const {
    withAndroidManifest,
    withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Expo config plugin: ensures `@drawable/notification_icon` exists in
// the Android resources after prebuild, and registers it as
// `expo.modules.notifications.default_notification_icon` in the
// manifest.
//
// Why this plugin exists
// ──────────────────────
// Android 13+ rejects any notification posted without a small icon —
// `NotificationManager.fixNotification` throws
// `IllegalArgumentException: Invalid notification (no valid small
// icon)`. For a foreground service that exception is fatal: it
// surfaces from inside `app.notifee.core.ForegroundService.
// onStartCommand`, which is a separate process callback that no JS
// `try/catch` can intercept, so the entire app crashes the moment
// the user toggles "always-on connection".
//
// `expo-notifications`' plugin generates `notification_icon` PNGs
// from the `icon` path in app.json, but that pipeline is fragile —
// any drift between config and what's actually on disk (stale
// prebuild, removed plugin config, missing density bucket) means
// the drawable doesn't resolve and the FGS crashes. Since
// `android/` is gitignored we can't ship a hand-edited drawable
// either — it would be wiped on the next prebuild.
//
// What we do
// ──────────
// Write a vector drawable (`res/drawable/notification_icon.xml`)
// during prebuild and register it as
// `expo.modules.notifications.default_notification_icon` in the
// manifest. The vector is a white-on-transparent V silhouette —
// the format Android requires for status-bar icons.
//
// Layering with expo-notifications
// ────────────────────────────────
// `expo-notifications` writes its own raster
// `drawable-<density>/notification_icon.png` files. Android picks
// density-specific drawables over the catch-all `drawable/` folder,
// so on devices that match one of those buckets the PNG wins
// (currently rendering as a white blob via alpha-mask conversion of
// the colored `icon-prod.png`). Our vector is the safety net: it
// resolves on any device where the PNG generation skipped a bucket
// or got nuked, which is precisely the corner that crashed in
// production. Crash prevention is the contract; visual polish is a
// follow-up that lives in the source PNG, not here.

const DRAWABLE_NAME = "notification_icon";
const NOTIFICATION_ICON_META =
    "expo.modules.notifications.default_notification_icon";
const FCM_DEFAULT_CHANNEL_META =
    "com.google.firebase.messaging.default_notification_channel_id";
const FCM_DEFAULT_COLOR_META =
    "com.google.firebase.messaging.default_notification_color";

function addToolsReplace(node, value) {
    const attrs = node.$ ?? {};
    const existing = attrs["tools:replace"];
    const values =
        typeof existing === "string" && existing.length > 0
            ? existing.split(",").map((item) => item.trim())
            : [];
    if (!values.includes(value)) {
        values.push(value);
    }
    node.$ = {
        ...attrs,
        "tools:replace": values.join(","),
    };
}

function findMetaData(application, name) {
    return application["meta-data"]?.find(
        (md) => md?.$?.["android:name"] === name,
    );
}

function findOrCreateMetaData(application, name, attrs) {
    const existing = findMetaData(application, name);
    if (existing) {
        return existing;
    }
    const node = {
        $: {
            "android:name": name,
            ...attrs,
        },
    };
    application["meta-data"].push(node);
    return node;
}

function ensureToolsNamespace(manifest) {
    manifest.$ = manifest.$ ?? {};
    manifest.$["xmlns:tools"] =
        manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";
}

// 24dp viewport is the Android-recommended canvas for status-bar
// drawables. The path is a stylized "V" stroke from upper-left
// through the bottom point and up to upper-right; rounded caps and
// joins keep the silhouette crisp at small sizes.
const VECTOR_DRAWABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#00000000"
        android:pathData="M5,5 L12,19 L19,5"
        android:strokeColor="#FFFFFFFF"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:strokeWidth="2.5"/>
</vector>
`;

function withNotificationIconDrawable(config) {
    return withDangerousMod(config, [
        "android",
        async (cfg) => {
            const projectRoot = cfg.modRequest.platformProjectRoot;
            const drawableDir = path.join(
                projectRoot,
                "app",
                "src",
                "main",
                "res",
                "drawable",
            );
            fs.mkdirSync(drawableDir, { recursive: true });
            const target = path.join(drawableDir, `${DRAWABLE_NAME}.xml`);
            fs.writeFileSync(target, VECTOR_DRAWABLE_XML, "utf8");
            return cfg;
        },
    ]);
}

function withNotificationIconManifest(config) {
    return withAndroidManifest(config, (cfg) => {
        ensureToolsNamespace(cfg.modResults.manifest);
        const application = cfg.modResults.manifest.application?.[0];
        if (!application) {
            return cfg;
        }
        application["meta-data"] = application["meta-data"] ?? [];
        const already = findMetaData(application, NOTIFICATION_ICON_META);
        if (!already) {
            application["meta-data"].push({
                $: {
                    "android:name": NOTIFICATION_ICON_META,
                    "android:resource": `@drawable/${DRAWABLE_NAME}`,
                },
            });
        }
        const fcmDefaultChannel = findOrCreateMetaData(
            application,
            FCM_DEFAULT_CHANNEL_META,
            { "android:value": "vex-push" },
        );
        addToolsReplace(fcmDefaultChannel, "android:value");
        const fcmDefaultColor = findOrCreateMetaData(
            application,
            FCM_DEFAULT_COLOR_META,
            { "android:resource": "@color/notification_icon_color" },
        );
        addToolsReplace(fcmDefaultColor, "android:resource");
        return cfg;
    });
}

module.exports = function withNotificationIcon(config) {
    config = withNotificationIconDrawable(config);
    config = withNotificationIconManifest(config);
    return config;
};
