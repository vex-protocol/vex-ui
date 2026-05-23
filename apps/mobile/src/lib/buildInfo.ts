import Constants from "expo-constants";
import * as Updates from "expo-updates";

export interface MobileCapabilities {
    alwaysOnConnection: boolean;
    localNotifications: boolean;
    otaUpdates: boolean;
    passkeys: boolean;
    remotePushNotifications: boolean;
}

export type MobileTarget = "dev" | "development" | "production";

const DEFAULT_CAPABILITIES: Record<MobileTarget, MobileCapabilities> = {
    dev: {
        alwaysOnConnection: false,
        localNotifications: true,
        otaUpdates: false,
        passkeys: true,
        remotePushNotifications: false,
    },
    development: {
        alwaysOnConnection: true,
        localNotifications: true,
        otaUpdates: true,
        passkeys: true,
        remotePushNotifications: true,
    },
    production: {
        alwaysOnConnection: true,
        localNotifications: true,
        otaUpdates: true,
        passkeys: true,
        remotePushNotifications: true,
    },
};

function booleanField(
    record: Record<string, unknown> | undefined,
    field: keyof MobileCapabilities,
    fallback: boolean,
): boolean {
    const value = record?.[field];
    return typeof value === "boolean" ? value : fallback;
}

function normalize(value: null | string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTarget(value: unknown): MobileTarget | undefined {
    return value === "dev" || value === "development" || value === "production"
        ? value
        : undefined;
}

const expoVersion = normalize(Constants.expoConfig?.version);
const publicVersion = normalize(process.env.EXPO_PUBLIC_VEX_APP_VERSION);
const commit = normalize(process.env.EXPO_PUBLIC_VEX_COMMIT_SHA) ?? "local";
const shortCommit =
    commit === "local" ? commit : commit.slice(0, 8).toLowerCase();
const displayVersion = `${publicVersion ?? expoVersion ?? "0.0.0"}-${shortCommit}`;
const updateId = Updates.updateId ?? undefined;
const shortUpdateId = updateId?.slice(0, 8);
const createdAt = Updates.createdAt?.toISOString();
const runtimeVersion = Updates.runtimeVersion ?? "unknown";
const shortRuntimeVersion = runtimeVersion.slice(0, 8);
const vexExtra =
    typeof Constants.expoConfig?.extra?.["vex"] === "object" &&
    Constants.expoConfig.extra["vex"] != null
        ? (Constants.expoConfig.extra["vex"] as Record<string, unknown>)
        : undefined;
const environment =
    normalize(
        typeof vexExtra?.["environment"] === "string"
            ? vexExtra["environment"]
            : undefined,
    ) ?? "production";
const target =
    normalizeTarget(vexExtra?.["target"]) ??
    (environment === "development" ? "development" : "production");
const capabilityOverrides =
    typeof vexExtra?.["capabilities"] === "object" &&
    vexExtra["capabilities"] != null
        ? (vexExtra["capabilities"] as Record<string, unknown>)
        : undefined;
const defaultCapabilities = DEFAULT_CAPABILITIES[target];
const capabilities: MobileCapabilities = {
    alwaysOnConnection: booleanField(
        capabilityOverrides,
        "alwaysOnConnection",
        defaultCapabilities.alwaysOnConnection,
    ),
    localNotifications: booleanField(
        capabilityOverrides,
        "localNotifications",
        defaultCapabilities.localNotifications,
    ),
    otaUpdates: booleanField(
        capabilityOverrides,
        "otaUpdates",
        defaultCapabilities.otaUpdates,
    ),
    passkeys: booleanField(
        capabilityOverrides,
        "passkeys",
        defaultCapabilities.passkeys,
    ),
    remotePushNotifications: booleanField(
        capabilityOverrides,
        "remotePushNotifications",
        defaultCapabilities.remotePushNotifications,
    ),
};

export const buildInfo = {
    androidPackage: Constants.expoConfig?.android?.package,
    capabilities,
    channel: Updates.channel ?? "embedded",
    commit,
    createdAt,
    displayVersion,
    environment,
    fingerprint: runtimeVersion,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    label: displayVersion,
    runtimeVersion,
    shortCommit,
    shortFingerprint: shortRuntimeVersion,
    shortRuntimeVersion,
    shortUpdateId,
    target,
    updateId,
    version: publicVersion ?? expoVersion ?? "0.0.0",
} as const;
