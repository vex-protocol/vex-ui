import Constants from "expo-constants";
import * as Updates from "expo-updates";

function normalize(value: null | string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

const expoVersion = normalize(Constants.expoConfig?.version);
const publicVersion = normalize(process.env.EXPO_PUBLIC_VEX_APP_VERSION);
const publicBuildLabel = normalize(process.env.EXPO_PUBLIC_VEX_BUILD_LABEL);
const commit = normalize(process.env.EXPO_PUBLIC_VEX_COMMIT_SHA) ?? "local";
const shortCommit =
    commit === "local" ? commit : commit.slice(0, 8).toLowerCase();
const version = publicVersion ?? expoVersion ?? "0.0.0";
const displayVersion = publicBuildLabel ?? `${version}-${shortCommit}`;
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

export const buildInfo = {
    androidPackage: Constants.expoConfig?.android?.package,
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
    updateId,
    version,
} as const;
