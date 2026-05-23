// Dynamic Expo config. app.json is the static base; this file overlays
// target-conditional fields so local emulator development, CI development,
// and production builds each get the right native capabilities.
//
//   VEX_MOBILE_TARGET=dev                   -> local dev-client flavor
//   VEX_MOBILE_TARGET=development           -> CI development APK flavor
//   VEX_MOBILE_TARGET=production            -> production flavor
//   EAS_BUILD_PROFILE                       -> fallback target source
//   legacy VEX_APP_ENV / VEX_ENABLE_DEV_BUILD -> fallback only
//   env override                            -> VEX_IOS_BUNDLE_IDENTIFIER (optional)
//   local personal-team iOS builds          -> VEX_DISABLE_IOS_CAPABILITIES=1
//
// CI development and production APKs both use EAS Update. Runtime
// compatibility is fingerprint-based, so JS/assets can ship OTA while
// native changes still require a fresh APK. Local dev-client builds use
// Metro instead and intentionally disable remote-push/update paths.
//
// CJS intentional: apps/mobile/package.json has no "type":"module", so
// a plain require('./package.json') is the simplest single-source-of-truth
// for the version field in local builds. CI release workflows may pass
// VEX_APP_VERSION to stamp a release tag version into the APK without
// needing a bot commit directly on protected branches.

const pkg = require("./package.json");
const { withEntitlementsPlist } = require("expo/config-plugins");

// EAS Update requires a stable project id to resolve the update channel.
// Created via the Expo dashboard — paired with EXPO_TOKEN in CI secrets.
const EAS_PROJECT_ID = "e0d4cba7-1f2a-4c26-9e66-1fd60178ad20";
const PROD_PASSKEY_RP_HOST = "api.vex.wtf";
const DEV_PASSKEY_RP_HOST = "dev.vex.wtf";
const ANDROID_ASSET_STATEMENTS_PLUGIN = "./plugins/withAndroidAssetStatements";
const MOBILE_TARGETS = new Set(["dev", "development", "production"]);

const withoutPersonalTeamUnsupportedIosCapabilities = (config) =>
    withEntitlementsPlist(config, (modConfig) => {
        delete modConfig.modResults["aps-environment"];
        delete modConfig.modResults["com.apple.developer.associated-domains"];
        return modConfig;
    });

function getPluginName(plugin) {
    return Array.isArray(plugin) ? plugin[0] : plugin;
}

function resolveHost(value) {
    const raw = value?.trim();
    if (!raw) return undefined;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;
    try {
        return new URL(withScheme).hostname;
    } catch {
        return raw
            .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
            .split("/")[0]
            .split(":")[0];
    }
}

function normalizeTarget(value) {
    const target = value?.trim();
    return MOBILE_TARGETS.has(target) ? target : undefined;
}

function resolveMobileTarget() {
    const explicitTarget = normalizeTarget(process.env.VEX_MOBILE_TARGET);
    if (explicitTarget) return explicitTarget;

    const buildProfileTarget = normalizeTarget(process.env.EAS_BUILD_PROFILE);
    if (buildProfileTarget) return buildProfileTarget;

    // Backward compatibility for older shell snippets and cached CI configs.
    // New commands should use VEX_MOBILE_TARGET instead.
    if (
        process.env.VEX_APP_ENV?.trim() === "development" ||
        process.env.VEX_ENABLE_DEV_BUILD === "1"
    ) {
        return "development";
    }
    return "production";
}

module.exports = ({ config }) => {
    const target = resolveMobileTarget();
    const devClientMode = target === "dev";
    const developmentMode = target !== "production";
    const environment = target === "production" ? "production" : "development";
    const capabilities = {
        alwaysOnConnection: target !== "dev",
        localNotifications: true,
        otaUpdates: target !== "dev",
        passkeys: true,
        remotePushNotifications: target !== "dev",
    };
    const iosCapabilitiesEnabled =
        process.env.VEX_DISABLE_IOS_CAPABILITIES !== "1";
    const appDisplayName =
        process.env.VEX_APP_DISPLAY_NAME ||
        (developmentMode ? "Vex Developer" : config.name);
    const iconPath = developmentMode
        ? "./assets/icon-dev.png"
        : "./assets/icon-prod.png";
    const androidAdaptiveForegroundPath = developmentMode
        ? "./assets/icon-dev-android.png"
        : "./assets/icon-prod-android.png";
    const iosBundleIdentifier =
        process.env.VEX_IOS_BUNDLE_IDENTIFIER ||
        (developmentMode
            ? "chat.vex.mobile.dev"
            : config.ios?.bundleIdentifier);
    const androidGoogleServicesFile = capabilities.remotePushNotifications
        ? process.env.VEX_ANDROID_GOOGLE_SERVICES_FILE ||
          config.android?.googleServicesFile
        : undefined;
    const appVersion = process.env.VEX_APP_VERSION || pkg.version;
    const passkeyRpHost =
        resolveHost(
            process.env.VEX_PASSKEY_RP_HOST ||
                process.env.EXPO_PUBLIC_SERVER_URL,
        ) || (developmentMode ? DEV_PASSKEY_RP_HOST : PROD_PASSKEY_RP_HOST);

    // Permissions required for the optional "Always-on connection"
    // foreground-service mode (Settings → Connection). Even when the
    // user never opts in, declaring these is harmless — Android only
    // grants what the app actually requests at runtime.
    const androidPermissions = Array.from(
        new Set([
            ...(config.android?.permissions ?? []),
            "FOREGROUND_SERVICE",
            "FOREGROUND_SERVICE_DATA_SYNC",
            "REQUEST_INSTALL_PACKAGES",
            "WAKE_LOCK",
        ]),
    );

    return {
        ...config,
        version: appVersion,
        name: appDisplayName,
        icon: iconPath,
        splash: {
            backgroundColor: "#0a0a0a",
            image: iconPath,
            resizeMode: "contain",
        },
        ios: {
            ...config.ios,
            bundleIdentifier: iosBundleIdentifier,
            associatedDomains: iosCapabilitiesEnabled
                ? [`webcredentials:${passkeyRpHost}`]
                : undefined,
        },
        android: {
            ...config.android,
            adaptiveIcon: {
                backgroundColor: "#0a0a0a",
                foregroundImage: androidAdaptiveForegroundPath,
            },
            package: developmentMode
                ? "chat.vex.mobile.dev"
                : config.android?.package,
            ...(androidGoogleServicesFile
                ? { googleServicesFile: androidGoogleServicesFile }
                : {}),
            permissions: androidPermissions,
        },
        updates: {
            enabled: capabilities.otaUpdates,
            url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
            checkAutomatically: "ON_LOAD",
            fallbackToCacheTimeout: 0,
        },
        runtimeVersion: { policy: "fingerprint" },
        extra: {
            ...config.extra,
            vex: { capabilities, environment, target },
            eas: { projectId: EAS_PROJECT_ID },
        },
        plugins: [
            ...(config.plugins ?? []).filter((plugin) => {
                const pluginName = getPluginName(plugin);
                if (pluginName === ANDROID_ASSET_STATEMENTS_PLUGIN) {
                    return false;
                }
                if (iosCapabilitiesEnabled) return true;
                return pluginName !== "expo-notifications";
            }),
            [ANDROID_ASSET_STATEMENTS_PLUGIN, { hosts: [passkeyRpHost] }],
            ...(devClientMode
                ? [
                      [
                          "expo-dev-client",
                          {
                              addGeneratedScheme: true,
                          },
                      ],
                  ]
                : []),
            [
                "expo-audio",
                {
                    enableBackgroundPlayback: false,
                    microphonePermission:
                        "Allow $(PRODUCT_NAME) to record voice memos.",
                    recordAudioAndroid: true,
                },
            ],
            [
                "expo-video",
                {
                    supportsBackgroundPlayback: false,
                    supportsPictureInPicture: false,
                },
            ],
            "expo-background-task",
            "./plugins/withForegroundService",
            "./plugins/withAndroidShareIntent",
            // Safety net for Notifee FGS small-icon resolution.
            // expo-notifications' density-specific
            // `notification_icon.png` files normally win on real
            // devices, but if any density bucket is missing the FGS
            // crashes the entire app. This plugin guarantees the
            // catch-all `@drawable/notification_icon` always
            // resolves to a valid white-on-transparent vector.
            "./plugins/withNotificationIcon",
            ...(iosCapabilitiesEnabled
                ? []
                : [withoutPersonalTeamUnsupportedIosCapabilities]),
        ],
    };
};
