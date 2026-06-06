const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

const CALLKEEP_CONNECTION_SERVICE = "io.wazo.callkeep.VoiceConnectionService";
const CALLKEEP_BACKGROUND_SERVICE =
    "io.wazo.callkeep.RNCallKeepBackgroundMessagingService";

function addUnique(list, value) {
    return list.includes(value) ? list : [...list, value];
}

function withAndroidCallKeepServices(config) {
    return withAndroidManifest(config, (cfg) => {
        const application = cfg.modResults.manifest.application?.[0];
        if (!application) {
            return cfg;
        }
        application.service = application.service ?? [];

        const hasConnectionService = application.service.some(
            (service) =>
                service?.$?.["android:name"] === CALLKEEP_CONNECTION_SERVICE,
        );
        if (!hasConnectionService) {
            application.service.push({
                $: {
                    "android:exported": "true",
                    "android:label": "Vex",
                    "android:name": CALLKEEP_CONNECTION_SERVICE,
                    "android:permission":
                        "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
                },
                "intent-filter": [
                    {
                        action: [
                            {
                                $: {
                                    "android:name":
                                        "android.telecom.ConnectionService",
                                },
                            },
                        ],
                    },
                ],
            });
        }

        const hasBackgroundService = application.service.some(
            (service) =>
                service?.$?.["android:name"] === CALLKEEP_BACKGROUND_SERVICE,
        );
        if (!hasBackgroundService) {
            application.service.push({
                $: {
                    "android:exported": "false",
                    "android:name": CALLKEEP_BACKGROUND_SERVICE,
                },
            });
        }

        return cfg;
    });
}

function withIosVoipBackgroundMode(config) {
    return withInfoPlist(config, (cfg) => {
        const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
            ? cfg.modResults.UIBackgroundModes
            : [];
        cfg.modResults.UIBackgroundModes = addUnique(
            addUnique(modes, "remote-notification"),
            "voip",
        );
        return cfg;
    });
}

module.exports = function withNativeCalls(config) {
    config = withAndroidCallKeepServices(config);
    config = withIosVoipBackgroundMode(config);
    return config;
};
