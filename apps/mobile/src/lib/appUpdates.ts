import { Linking, Platform } from "react-native";

import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Updates from "expo-updates";
import { atom } from "nanostores";

import { buildInfo } from "./buildInfo";

export interface AppUpdateState {
    apkDownloadProgress?: number | undefined;
    checkedAt?: string | undefined;
    error?: string | undefined;
    latestCommit?: GitHubCommitInfo | undefined;
    message?: string | undefined;
    nativeRelease?: NativeReleaseInfo | undefined;
    otaCheckError?: string | undefined;
    otaUpdateAvailable?: boolean | undefined;
    releaseTarget: "development" | "production";
    status: AppUpdateStatus;
}

export type AppUpdateStatus =
    | "apk_available"
    | "apk_downloading"
    | "checking"
    | "current"
    | "error"
    | "idle"
    | "ota_available"
    | "ota_ready"
    | "unsupported";

export interface GitHubCommitInfo {
    committedAt?: string | undefined;
    htmlUrl?: string | undefined;
    sha: string;
    shortSha: string;
}

export interface NativeReleaseInfo {
    apkName?: string | undefined;
    apkUrl?: string | undefined;
    fingerprint?: string | undefined;
    fingerprintShort?: string | undefined;
    htmlUrl: string;
    iosBuildId?: string | undefined;
    iosInstallUrl?: string | undefined;
    publishedAt?: string | undefined;
    sha256?: string | undefined;
    tagName: string;
    targetCommit?: string | undefined;
    targetShortCommit?: string | undefined;
}

interface FetchOtaUpdateOptions {
    autoReload?: boolean | undefined;
}

type GitHubCompareStatus = "ahead" | "behind" | "diverged" | "identical";

const GITHUB_REPO = "vex-protocol/vex-ui";
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;
const UPDATE_CHECK_THROTTLE_MS = 15 * 60 * 1000;
const APK_MIME = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FINGERPRINT_ASSET_BY_PLATFORM = {
    android: "fingerprint-android.json",
    ios: "fingerprint-ios.json",
} as const;
const IOS_INSTALL_ASSET_NAMES = new Set([
    "ios-install.json",
    "vex-ios-install.json",
]);
const externalFetch = globalThis.fetch.bind(globalThis);

export const $appUpdateState = atom<AppUpdateState>({
    releaseTarget: getReleaseTarget(),
    status: "idle",
});

let updateCheckInFlight: null | Promise<AppUpdateState> = null;
let pendingOtaAutoReloadSuppressed = false;

export async function checkForAppUpdates(
    options: { force?: boolean; silent?: boolean } = {},
): Promise<AppUpdateState> {
    if (updateCheckInFlight) {
        return updateCheckInFlight;
    }

    const current = $appUpdateState.get();
    if (
        options.force !== true &&
        current.checkedAt != null &&
        Date.now() - Date.parse(current.checkedAt) < UPDATE_CHECK_THROTTLE_MS
    ) {
        return current;
    }

    if (options.silent !== true) {
        $appUpdateState.set({
            ...current,
            releaseTarget: getReleaseTarget(),
            status: "checking",
        });
    }

    updateCheckInFlight = runUpdateCheck()
        .then((next) => {
            $appUpdateState.set(next);
            return next;
        })
        .catch((err: unknown) => {
            const next: AppUpdateState = {
                ...$appUpdateState.get(),
                checkedAt: new Date().toISOString(),
                error: errorMessage(err),
                releaseTarget: getReleaseTarget(),
                status: "error",
            };
            $appUpdateState.set(next);
            return next;
        })
        .finally(() => {
            updateCheckInFlight = null;
        });

    return updateCheckInFlight;
}

export async function downloadAndInstallApkUpdate(): Promise<void> {
    const release = $appUpdateState.get().nativeRelease;
    if (Platform.OS !== "android") {
        await openNativeBuildInstallPage();
        return;
    }
    if (!release?.apkUrl || !release.apkName) {
        throw new Error("No APK release is available.");
    }

    try {
        const current = $appUpdateState.get();
        $appUpdateState.set({
            ...current,
            apkDownloadProgress: 0,
            status: "apk_downloading",
        });

        const cacheDirectory = FileSystem.cacheDirectory;
        if (!cacheDirectory) {
            throw new Error("Device cache directory is unavailable.");
        }
        const apkName = sanitizeApkName(release.apkName);
        const destination = `${cacheDirectory}${apkName}`;

        const download = FileSystem.createDownloadResumable(
            release.apkUrl,
            destination,
            {},
            (progress) => {
                const total = progress.totalBytesExpectedToWrite;
                if (total <= 0) return;
                $appUpdateState.set({
                    ...$appUpdateState.get(),
                    apkDownloadProgress:
                        progress.totalBytesWritten /
                        progress.totalBytesExpectedToWrite,
                });
            },
        );

        const result = await download.downloadAsync();
        if (!result?.uri) {
            throw new Error("APK download did not produce a local file.");
        }

        if (release.sha256) {
            const actual = await sha256File(result.uri);
            if (actual !== release.sha256) {
                throw new Error(
                    `APK checksum mismatch. Expected ${release.sha256.slice(
                        0,
                        12,
                    )}, got ${actual.slice(0, 12)}.`,
                );
            }
        }

        const contentUri = await FileSystem.getContentUriAsync(result.uri);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
            data: contentUri,
            flags: FLAG_GRANT_READ_URI_PERMISSION,
            type: APK_MIME,
        });

        $appUpdateState.set({
            ...$appUpdateState.get(),
            apkDownloadProgress: 1,
            message: "Android installer opened.",
            status: "apk_available",
        });
    } catch (err: unknown) {
        $appUpdateState.set({
            ...$appUpdateState.get(),
            error: errorMessage(err),
            message: errorMessage(err),
            status: "apk_available",
        });
        throw err;
    }
}

export async function fetchOtaUpdate(
    options: FetchOtaUpdateOptions = {},
): Promise<AppUpdateState> {
    if (!Updates.isEnabled || __DEV__) {
        throw new Error("OTA updates are not enabled in this build.");
    }
    const suppressAutoReload = options.autoReload === false;
    if (suppressAutoReload) {
        pendingOtaAutoReloadSuppressed = true;
    } else {
        pendingOtaAutoReloadSuppressed = false;
    }
    const current = $appUpdateState.get();
    $appUpdateState.set({ ...current, status: "checking" });
    try {
        const result = await Updates.fetchUpdateAsync();
        if (!result.isNew && suppressAutoReload) {
            pendingOtaAutoReloadSuppressed = false;
        }
        const next: AppUpdateState = {
            ...$appUpdateState.get(),
            checkedAt: new Date().toISOString(),
            message: result.isNew
                ? "OTA update downloaded. Restart Vex to run it."
                : "No newer OTA update was downloaded.",
            otaUpdateAvailable: result.isNew,
            releaseTarget: getReleaseTarget(),
            status: result.isNew ? "ota_ready" : "current",
        };
        $appUpdateState.set(next);
        return next;
    } catch (err: unknown) {
        if (suppressAutoReload) {
            pendingOtaAutoReloadSuppressed = false;
        }
        throw err;
    }
}

export function getNativeBuildInstallUrl(
    release: NativeReleaseInfo | undefined = $appUpdateState.get()
        .nativeRelease,
): string | undefined {
    if (!release) return undefined;
    if (Platform.OS === "ios") {
        return release.iosInstallUrl ?? release.htmlUrl;
    }
    return release.htmlUrl;
}

export async function openNativeBuildInstallPage(): Promise<void> {
    const url = getNativeBuildInstallUrl();
    if (!url) {
        throw new Error("No native build install page is available.");
    }
    await Linking.openURL(url);
}

export async function openUnknownAppSourcesSettings(): Promise<void> {
    if (Platform.OS !== "android") {
        return;
    }
    try {
        await IntentLauncher.startActivityAsync(
            IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
            buildInfo.androidPackage
                ? { data: `package:${buildInfo.androidPackage}` }
                : {},
        );
    } catch {
        await IntentLauncher.startActivityAsync(
            IntentLauncher.ActivityAction.SECURITY_SETTINGS,
        );
    }
}

export async function restartForOtaUpdate(): Promise<void> {
    if (!Updates.isEnabled || __DEV__) {
        throw new Error("OTA restart is not available in this build.");
    }
    await Updates.reloadAsync();
}

export function shouldAutoReloadPendingOtaUpdate(): boolean {
    return !pendingOtaAutoReloadSuppressed;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
    return Array.isArray(record[field]) ? record[field] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value != null
        ? (value as Record<string, unknown>)
        : {};
}

async function checkOtaUpdate(): Promise<{
    error?: string;
    isAvailable: boolean;
}> {
    if (!Updates.isEnabled || __DEV__) {
        return {
            error: "expo-updates disabled",
            isAvailable: false,
        };
    }
    const result = await Updates.checkForUpdateAsync();
    return { isAvailable: result.isAvailable };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function extractExpoBuildUrl(value: string | undefined): string | undefined {
    const match = value?.match(
        /https:\/\/expo\.dev\/accounts\/[^\s)]+\/projects\/[^\s)]+\/builds\/[0-9a-f-]+/i,
    );
    return normalizeHttpUrl(match?.[0]);
}

async function fetchFingerprintHash(
    url: string | undefined,
): Promise<string | undefined> {
    if (!url) return undefined;
    const record = asRecord(await fetchGitHubJson(url));
    return (
        stringField(record, "hash") ??
        stringField(asRecord(record[Platform.OS]), "hash")
    );
}

async function fetchGitHubCompareStatus(
    base: string | undefined,
    head: string | undefined,
): Promise<GitHubCompareStatus | undefined> {
    const baseSha = normalizeSha(base);
    const headSha = normalizeSha(head);
    if (!baseSha || !headSha) return undefined;
    const record = asRecord(
        await fetchGitHubJson(
            `${GITHUB_API_BASE}/compare/${baseSha}...${headSha}`,
        ),
    );
    const status = stringField(record, "status");
    return isGitHubCompareStatus(status) ? status : undefined;
}

async function fetchGitHubJson(url: string): Promise<unknown> {
    const response = await externalFetch(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${String(response.status)}`);
    }
    return response.json();
}

async function fetchIosInstallInfo(url: string | undefined): Promise<
    | undefined
    | {
          buildId?: string | undefined;
          installUrl?: string | undefined;
      }
> {
    if (!url) return undefined;
    const record = asRecord(await fetchGitHubJson(url));
    const ios = asRecord(record["ios"]);
    return {
        buildId: stringField(record, "buildId") ?? stringField(ios, "buildId"),
        installUrl: normalizeHttpUrl(
            stringField(record, "installUrl") ??
                stringField(record, "buildUrl") ??
                stringField(record, "url") ??
                stringField(ios, "installUrl") ??
                stringField(ios, "buildUrl") ??
                stringField(ios, "url"),
        ),
    };
}

async function fetchLatestCommit(branch: string): Promise<GitHubCommitInfo> {
    const record = asRecord(
        await fetchGitHubJson(`${GITHUB_API_BASE}/commits/${branch}`),
    );
    const sha = stringField(record, "sha");
    if (!sha) {
        throw new Error("GitHub commit response did not include a SHA.");
    }
    const commitRecord = asRecord(record["commit"]);
    const committer = asRecord(commitRecord["committer"]);
    const author = asRecord(commitRecord["author"]);
    return {
        committedAt:
            stringField(committer, "date") ?? stringField(author, "date"),
        htmlUrl: stringField(record, "html_url"),
        sha,
        shortSha: sha.slice(0, 8).toLowerCase(),
    };
}

async function fetchNativeRelease(
    target: "development" | "production",
): Promise<NativeReleaseInfo | undefined> {
    const url =
        target === "development"
            ? `${GITHUB_API_BASE}/releases/tags/mobile-rc-latest`
            : `${GITHUB_API_BASE}/releases/latest`;
    const release = asRecord(await fetchGitHubJson(url));
    const assets = arrayField(release, "assets").map(asRecord);
    const body = stringField(release, "body");
    const apkAsset =
        assets.find((asset) =>
            stringField(asset, "name")?.endsWith("latest.apk"),
        ) ??
        assets.find((asset) => stringField(asset, "name")?.endsWith(".apk"));
    const apkName = apkAsset ? stringField(apkAsset, "name") : undefined;
    const platformFingerprintAssetName =
        Platform.OS === "android" || Platform.OS === "ios"
            ? FINGERPRINT_ASSET_BY_PLATFORM[Platform.OS]
            : undefined;
    const fingerprintAsset =
        platformFingerprintAssetName != null
            ? (assets.find(
                  (asset) =>
                      stringField(asset, "name") ===
                      platformFingerprintAssetName,
              ) ??
              assets.find(
                  (asset) => stringField(asset, "name") === "fingerprint.json",
              ))
            : assets.find(
                  (asset) => stringField(asset, "name") === "fingerprint.json",
              );
    const checksumAsset =
        apkName != null
            ? assets.find(
                  (asset) => stringField(asset, "name") === `${apkName}.sha256`,
              )
            : undefined;
    const iosInstallAsset = assets.find((asset) => {
        const name = stringField(asset, "name")?.toLowerCase();
        return name != null && IOS_INSTALL_ASSET_NAMES.has(name);
    });

    const fingerprint = fingerprintAsset
        ? await fetchFingerprintHash(
              stringField(fingerprintAsset, "browser_download_url"),
          )
        : undefined;
    const iosInstallInfo = iosInstallAsset
        ? await fetchIosInstallInfo(
              stringField(iosInstallAsset, "browser_download_url"),
          )
        : undefined;
    const sha256 = checksumAsset
        ? await fetchSha256(stringField(checksumAsset, "browser_download_url"))
        : undefined;
    const targetCommit = normalizeSha(stringField(release, "target_commitish"));

    return {
        apkName,
        apkUrl: apkAsset
            ? stringField(apkAsset, "browser_download_url")
            : undefined,
        fingerprint,
        fingerprintShort: fingerprint?.slice(0, 8),
        htmlUrl:
            stringField(release, "html_url") ??
            "https://github.com/vex-protocol/vex-ui/releases",
        iosBuildId: iosInstallInfo?.buildId,
        iosInstallUrl: iosInstallInfo?.installUrl ?? extractExpoBuildUrl(body),
        publishedAt: stringField(release, "published_at"),
        sha256,
        tagName: stringField(release, "tag_name") ?? "unknown",
        targetCommit,
        targetShortCommit: targetCommit?.slice(0, 8),
    };
}

async function fetchReleaseCandidateRunPending(
    commit: string | undefined,
): Promise<boolean> {
    const sha = normalizeSha(commit);
    if (!sha) return false;
    const params = new URLSearchParams({
        branch: "development",
        event: "push",
        head_sha: sha,
        per_page: "1",
    });
    const record = asRecord(
        await fetchGitHubJson(
            `${GITHUB_API_BASE}/actions/workflows/dev-mobile.yml/runs?${params.toString()}`,
        ),
    );
    const run = arrayField(record, "workflow_runs")
        .map(asRecord)
        .find((candidate) =>
            sameCommit(stringField(candidate, "head_sha"), sha),
        );
    const status = stringField(run ?? {}, "status");
    return status != null && status !== "completed";
}

async function fetchSha256(
    url: string | undefined,
): Promise<string | undefined> {
    if (!url) return undefined;
    const response = await externalFetch(url, {
        headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
        throw new Error(
            `GitHub checksum returned HTTP ${String(response.status)}`,
        );
    }
    const text = await response.text();
    return text.match(/[a-fA-F0-9]{64}/)?.[0]?.toLowerCase();
}

function getReleaseTarget(): "development" | "production" {
    return buildInfo.environment === "development" ||
        buildInfo.channel === "development"
        ? "development"
        : "production";
}

function isGitHubCompareStatus(
    value: string | undefined,
): value is GitHubCompareStatus {
    return (
        value === "ahead" ||
        value === "behind" ||
        value === "diverged" ||
        value === "identical"
    );
}

function isNativeReleaseNewer(
    release: NativeReleaseInfo | undefined,
    latestCommit: GitHubCommitInfo | undefined,
    releaseCompareStatus: GitHubCompareStatus | undefined,
    releaseCandidateRunPending: boolean,
): boolean {
    if (!release) return false;
    if (
        sameCommit(buildInfo.commit, latestCommit?.sha) ||
        sameCommit(buildInfo.commit, release.targetCommit)
    ) {
        return false;
    }
    // APK releases are native baselines and may lag branch HEAD after OTA-only
    // commits. Only suppress one when the running app already contains it.
    if (releaseCompareStatus === "ahead") {
        return false;
    }
    if (releaseCandidateRunPending) {
        return false;
    }

    const releaseFingerprint = normalizeFingerprint(release.fingerprint);
    const buildFingerprint = normalizeFingerprint(buildInfo.fingerprint);
    if (
        releaseFingerprint != null &&
        buildFingerprint != null &&
        releaseFingerprint !== buildFingerprint
    ) {
        return true;
    }

    if (__DEV__) {
        return false;
    }

    if (!Updates.isEnabled) {
        return (
            release.targetCommit != null &&
            !sameCommit(buildInfo.commit, release.targetCommit)
        );
    }

    return false;
}

function isOtaRuntimeCompatible(
    release: NativeReleaseInfo | undefined,
): boolean {
    const releaseFingerprint = normalizeFingerprint(release?.fingerprint);
    const buildFingerprint = normalizeFingerprint(buildInfo.fingerprint);
    return (
        releaseFingerprint != null &&
        buildFingerprint != null &&
        releaseFingerprint === buildFingerprint
    );
}

function normalizeFingerprint(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim().toLowerCase();
    return /^[a-f0-9]{16,128}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:"
            ? url.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

function normalizeSha(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim().toLowerCase();
    return /^[a-f0-9]{7,40}$/.test(trimmed) ? trimmed : undefined;
}

async function runUpdateCheck(): Promise<AppUpdateState> {
    const target = getReleaseTarget();
    const branch = target === "development" ? "development" : "master";
    const checkedAt = new Date().toISOString();

    const [commitResult, releaseResult, otaResult] = await Promise.allSettled([
        fetchLatestCommit(branch),
        fetchNativeRelease(target),
        checkOtaUpdate(),
    ]);

    const latestCommit =
        commitResult.status === "fulfilled" ? commitResult.value : undefined;
    const nativeRelease =
        releaseResult.status === "fulfilled" ? releaseResult.value : undefined;
    const releaseCompareStatus =
        nativeRelease?.targetCommit != null
            ? await fetchGitHubCompareStatus(
                  nativeRelease.targetCommit,
                  buildInfo.commit,
              ).catch(() => undefined)
            : undefined;
    const releaseCandidateRunPending =
        target === "development" &&
        latestCommit != null &&
        nativeRelease?.targetCommit != null &&
        !sameCommit(nativeRelease.targetCommit, latestCommit.sha) &&
        (await fetchReleaseCandidateRunPending(latestCommit.sha).catch(
            () => false,
        ));
    const ota =
        otaResult.status === "fulfilled"
            ? otaResult.value
            : {
                  error: errorMessage(otaResult.reason),
                  isAvailable: false,
              };

    const runningLatestCommit =
        latestCommit != null && sameCommit(buildInfo.commit, latestCommit.sha);
    const canUseOtaUpdates = Updates.isEnabled && !__DEV__;
    const branchHasNewerCommit = latestCommit != null && !runningLatestCommit;
    const nativeUpdateAvailable =
        (Platform.OS === "android" || Platform.OS === "ios") &&
        isNativeReleaseNewer(
            nativeRelease,
            latestCommit,
            releaseCompareStatus,
            releaseCandidateRunPending,
        );
    const otaUpdateAvailable =
        canUseOtaUpdates &&
        branchHasNewerCommit &&
        (ota.isAvailable ||
            (ota.error == null && isOtaRuntimeCompatible(nativeRelease)));

    if (otaUpdateAvailable) {
        return {
            checkedAt,
            latestCommit,
            message: latestCommit
                ? ota.isAvailable
                    ? `Compatible OTA available at ${latestCommit.shortSha}.`
                    : `Compatible OTA runtime detected for ${latestCommit.shortSha}.`
                : "Compatible OTA update available.",
            nativeRelease,
            otaCheckError: ota.error,
            otaUpdateAvailable: true,
            releaseTarget: target,
            status: "ota_available",
        };
    }

    if (nativeUpdateAvailable && nativeRelease) {
        return {
            checkedAt,
            latestCommit,
            message:
                Platform.OS === "ios"
                    ? "Native runtime changed. Install the latest Vex build."
                    : "Native runtime changed. Install the latest APK.",
            nativeRelease,
            otaCheckError: ota.error,
            otaUpdateAvailable: false,
            releaseTarget: target,
            status: "apk_available",
        };
    }

    if (!Updates.isEnabled || __DEV__) {
        return {
            checkedAt,
            latestCommit,
            message: "OTA updates are unavailable in this local build.",
            nativeRelease,
            otaCheckError: ota.error,
            otaUpdateAvailable: false,
            releaseTarget: target,
            status: "unsupported",
        };
    }

    return {
        checkedAt,
        latestCommit,
        message:
            releaseCandidateRunPending && latestCommit != null
                ? `APK build is still running for ${latestCommit.shortSha}. Check again shortly.`
                : latestCommit != null && !runningLatestCommit && ota.error
                  ? "Could not confirm OTA availability. Continuing with installed build."
                  : latestCommit != null && !runningLatestCommit
                    ? "GitHub has a newer commit, but no compatible OTA is published for this runtime yet."
                    : "Vex is up to date.",
        nativeRelease,
        otaCheckError: ota.error,
        otaUpdateAvailable: false,
        releaseTarget: target,
        status: "current",
    };
}

function sameCommit(
    left: string | undefined,
    right: string | undefined,
): boolean {
    const a = normalizeSha(left);
    const b = normalizeSha(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
}

function sanitizeApkName(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "-");
    return safe.endsWith(".apk") ? safe : `${safe}.apk`;
}

async function sha256File(fileUri: string): Promise<string> {
    const bytes = await new File(fileUri).bytes();
    const digest = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        bytes,
    );
    return arrayBufferToHex(digest);
}

function stringField(
    record: Record<string, unknown>,
    field: string,
): string | undefined {
    const value = record[field];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
