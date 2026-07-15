// Dynamic Expo config. app.json is the static base; this file overlays
// profile-conditional fields so `development` and `production` EAS build
// profiles can produce two distinct APKs that can coexist on one device.
//
//   default (all profiles)             → production flavor
//   VEX_ENABLE_DEV_BUILD=1 + profile=development → dev flavor (opt-in)
//   env override                        → VEX_IOS_BUNDLE_IDENTIFIER (optional)
//   local prod iOS install              → VEX_IOS_ASSOCIATED_DOMAIN_MODE=developer
//   local personal-team iOS builds      → VEX_DISABLE_IOS_CAPABILITIES=1
//
// Dev and production APKs both use EAS Update. Runtime compatibility is
// fingerprint-based, so JS/assets can ship OTA while native changes still
// require a fresh APK.
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

function resolveRuntimeVersion(value) {
    const raw = value?.trim();
    return raw && raw.length > 0 ? raw : undefined;
}

module.exports = ({ config }) => {
    const requestedEnvironment = process.env.VEX_APP_ENV;
    const devFlavorEnabled =
        process.env.VEX_ENABLE_DEV_BUILD === "1" ||
        requestedEnvironment === "development";
    const devMode =
        devFlavorEnabled &&
        (process.env.EAS_BUILD_PROFILE === "development" ||
            requestedEnvironment === "development");
    const iosCapabilitiesEnabled =
        process.env.VEX_DISABLE_IOS_CAPABILITIES !== "1";
    const appDisplayName =
        process.env.VEX_APP_DISPLAY_NAME ||
        (devMode ? "Vex Development" : config.name);
    const iconPath = devMode
        ? "./assets/icon-dev.png"
        : "./assets/icon-prod.png";
    const androidAdaptiveForegroundPath = devMode
        ? "./assets/icon-dev-android.png"
        : "./assets/icon-prod-android.png";
    const iosBundleIdentifier =
        process.env.VEX_IOS_BUNDLE_IDENTIFIER ||
        (devMode ? "chat.vex.mobile.dev" : config.ios?.bundleIdentifier);
    const androidGoogleServicesFile =
        process.env.VEX_ANDROID_GOOGLE_SERVICES_FILE ||
        config.android?.googleServicesFile;
    const appVersion = process.env.VEX_APP_VERSION || pkg.version;
    const environment = devMode ? "development" : "production";
    const updateChannel = devMode ? "development" : "production";
    const passkeyRpHost =
        resolveHost(
            process.env.VEX_PASSKEY_RP_HOST ||
                process.env.EXPO_PUBLIC_SERVER_URL,
        ) || (devMode ? DEV_PASSKEY_RP_HOST : PROD_PASSKEY_RP_HOST);
    const associatedDomainMode =
        process.env.VEX_IOS_ASSOCIATED_DOMAIN_MODE?.trim().toLowerCase();
    const useDeveloperAssociatedDomain = associatedDomainMode === "developer";
    const passkeyAssociatedDomain = `webcredentials:${passkeyRpHost}${
        useDeveloperAssociatedDomain ? "?mode=developer" : ""
    }`;
    const runtimeVersionOverride = resolveRuntimeVersion(
        process.env.VEX_RUNTIME_VERSION,
    );
    const androidRuntimeVersionOverride =
        resolveRuntimeVersion(process.env.VEX_ANDROID_RUNTIME_VERSION) ??
        runtimeVersionOverride;
    const iosRuntimeVersionOverride =
        resolveRuntimeVersion(process.env.VEX_IOS_RUNTIME_VERSION) ??
        runtimeVersionOverride;

    // Permissions required for the optional "Always-on connection"
    // foreground-service mode (Settings → Connection). Even when the
    // user never opts in, declaring these is harmless — Android only
    // grants what the app actually requests at runtime.
    const androidPermissions = Array.from(
        new Set([
            ...(config.android?.permissions ?? []),
            "BLUETOOTH_CONNECT",
            "CAMERA",
            "FOREGROUND_SERVICE",
            "FOREGROUND_SERVICE_DATA_SYNC",
            "MODIFY_AUDIO_SETTINGS",
            "REQUEST_INSTALL_PACKAGES",
            "RECORD_AUDIO",
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
            ...(iosRuntimeVersionOverride
                ? { runtimeVersion: iosRuntimeVersionOverride }
                : {}),
            associatedDomains: iosCapabilitiesEnabled
                ? [passkeyAssociatedDomain]
                : undefined,
            config: {
                ...config.ios?.config,
                usesNonExemptEncryption: true,
            },
            infoPlist: {
                ...config.ios?.infoPlist,
                NSCameraUsageDescription:
                    "Allow $(PRODUCT_NAME) to use the camera to take photos to send in chats.",
                NSMicrophoneUsageDescription:
                    "Allow $(PRODUCT_NAME) to use the microphone for voice calls and voice memos.",
                NSPhotoLibraryUsageDescription:
                    "Allow $(PRODUCT_NAME) to choose photos to send in chats and update your profile.",
            },
        },
        android: {
            ...config.android,
            adaptiveIcon: {
                backgroundColor: "#0a0a0a",
                foregroundImage: androidAdaptiveForegroundPath,
            },
            package: devMode ? "chat.vex.mobile.dev" : config.android?.package,
            ...(androidRuntimeVersionOverride
                ? { runtimeVersion: androidRuntimeVersionOverride }
                : {}),
            ...(androidGoogleServicesFile
                ? { googleServicesFile: androidGoogleServicesFile }
                : {}),
            permissions: androidPermissions,
        },
        updates: {
            enabled: true,
            url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
            // Local USB installs do not get EAS Build's profile-derived
            // channel injection, so stamp the channel into native config here.
            requestHeaders: {
                "expo-channel-name": updateChannel,
            },
            checkAutomatically: "ON_LOAD",
            fallbackToCacheTimeout: 0,
        },
        runtimeVersion: { policy: "fingerprint" },
        extra: {
            ...config.extra,
            vex: { environment, updateChannel },
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
            [
                "expo-audio",
                {
                    enableBackgroundPlayback: false,
                    microphonePermission:
                        "Allow $(PRODUCT_NAME) to use the microphone for voice calls and voice memos.",
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
            [
                "expo-camera",
                {
                    barcodeScannerEnabled: false,
                    cameraPermission:
                        "Allow $(PRODUCT_NAME) to use the camera to take photos to send in chats.",
                    recordAudioAndroid: false,
                },
            ],
            "react-native-iap",
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
