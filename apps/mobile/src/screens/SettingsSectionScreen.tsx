import type { AppScreenProps } from "../navigation/types";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Alert,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    Vibration,
    View,
} from "react-native";

import {
    $channels,
    $localMessageRetentionDays,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { Avatar } from "../components/Avatar";
import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import {
    $appUpdateState,
    checkForAppUpdates,
    downloadAndInstallApkUpdate,
    fetchOtaUpdate,
    openUnknownAppSourcesSettings,
    restartForOtaUpdate,
} from "../lib/appUpdates";
import { $avatarCropResult } from "../lib/avatarCropResult";
import { buildInfo } from "../lib/buildInfo";
import { getServerUrl } from "../lib/config";
import { $devOptionsUnlocked, setDevOptionsUnlocked } from "../lib/devMode";
import {
    $alwaysOnEnabled,
    openBatteryOptimizationSettings,
    startAlwaysOn,
    stopAlwaysOn,
} from "../lib/foregroundService";
import { requestNotificationPermission } from "../lib/notifications";
import {
    $pushNotificationsEnabled,
    $pushNotificationStatus,
    setPushNotificationsEnabled,
    unsubscribeStoredPushNotificationSubscription,
} from "../lib/pushNotifications";
import { persistLocalMessageRetentionDays } from "../lib/retentionPreference";
import { colors, typography } from "../theme";

const LOCAL_RETENTION_CHOICES = [7, 14, 21, 30] as const;

const DEV_UNLOCK_TAPS = 7;
const DEV_UNLOCK_WINDOW_MS = 3000;

export function SettingsSectionScreen({
    navigation,
    route,
}: AppScreenProps<"SettingsSection">) {
    const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
    const appUpdateState = useStore($appUpdateState);
    const channelsByServer = useStore($channels);
    const servers = useStore($servers);
    const user = useStore($user);
    const localRetentionDays = useStore($localMessageRetentionDays);
    const section = route.params.section;
    const [aboutRefreshing, setAboutRefreshing] = useState(false);
    const [avatarError, setAvatarError] = useState("");
    const [avatarLastAttemptBytes, setAvatarLastAttemptBytes] = useState<
        null | number
    >(null);
    const [avatarNotice, setAvatarNotice] = useState("");
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [updateBusy, setUpdateBusy] = useState(false);
    const [wsDebugEnabled, setWsDebugEnabled] = useState(() =>
        vexService.getWebsocketDebugEnabled(),
    );
    const [wsFrameDebugEnabled, setWsFrameDebugEnabled] = useState(() =>
        vexService.getWebsocketFrameDebugEnabled(),
    );
    const [wsStateDebugEnabled, setWsStateDebugEnabled] = useState(() =>
        vexService.getWebsocketStateDebugEnabled(),
    );
    // Cropper hand-off: when the cropper screen finishes, it writes a
    // result here. We stash the request id we kicked off with so we
    // only consume *our* result (not stale state from a previous
    // cropper invocation that the user cancelled).
    const cropResult = useStore($avatarCropResult);
    const aboutRefreshInFlightRef = useRef(false);
    const expectedCropRequestRef = useRef<null | number>(null);
    // Easter-egg counter for unlocking the developer surface from
    // About → Version. State sticks while the user is on this screen;
    // navigating away resets it (component unmount drops the closure).
    const devUnlocked = useStore($devOptionsUnlocked);
    const [versionTaps, setVersionTaps] = useState(0);
    const versionTapResetRef = useRef<null | ReturnType<typeof setTimeout>>(
        null,
    );
    useEffect(() => {
        return () => {
            if (versionTapResetRef.current) {
                clearTimeout(versionTapResetRef.current);
            }
        };
    }, []);

    function handleVersionTap(): void {
        if (devUnlocked) {
            return;
        }
        if (versionTapResetRef.current) {
            clearTimeout(versionTapResetRef.current);
        }
        const next = versionTaps + 1;
        if (next >= DEV_UNLOCK_TAPS) {
            setVersionTaps(0);
            Vibration.vibrate([0, 25, 60, 25, 60, 25]);
            void setDevOptionsUnlocked(true);
            return;
        }
        setVersionTaps(next);
        Vibration.vibrate(8);
        versionTapResetRef.current = setTimeout(() => {
            setVersionTaps(0);
        }, DEV_UNLOCK_WINDOW_MS);
    }

    function handleLockDeveloperOptions(): void {
        Alert.alert(
            "Lock developer options?",
            "The diagnostics menu will be hidden again until you re-enter the easter egg in About.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void setDevOptionsUnlocked(false);
                        // Bounce back to Settings; the developer
                        // section will be hidden once we land there.
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                        }
                    },
                    style: "destructive",
                    text: "Lock",
                },
            ],
        );
    }

    const title = useMemo(() => {
        switch (section) {
            case "about":
                return "About";
            case "account":
                return "Account";
            case "connection":
                return "Connection";
            case "data":
                return "Data";
            case "developer":
                return "Developer";
            case "notifications":
                return "Notifications";
            default:
                return "Settings";
        }
    }, [section]);

    const alwaysOn = useStore($alwaysOnEnabled);
    const pushNotificationsEnabled = useStore($pushNotificationsEnabled);
    const pushNotificationStatus = useStore($pushNotificationStatus);
    const [alwaysOnBusy, setAlwaysOnBusy] = useState(false);
    const [pushNotificationsBusy, setPushNotificationsBusy] = useState(false);

    async function handlePushNotificationsToggle(next: boolean): Promise<void> {
        if (pushNotificationsBusy) {
            return;
        }
        setPushNotificationsBusy(true);
        try {
            await setPushNotificationsEnabled(next);
            if (next && $pushNotificationStatus.get() === "denied") {
                Alert.alert(
                    "Notification permission needed",
                    "Enable notifications for Vex in system settings, then try again.",
                );
            }
        } catch (err: unknown) {
            console.warn(
                "[vex-push] toggle failed",
                err instanceof Error ? err.message : String(err),
            );
            Alert.alert(
                "Notifications unavailable",
                "Vex could not update push notifications right now.",
            );
        } finally {
            setPushNotificationsBusy(false);
        }
    }

    async function handleAlwaysOnToggle(next: boolean): Promise<void> {
        if (alwaysOnBusy) {
            return;
        }
        setAlwaysOnBusy(true);
        try {
            if (next) {
                // Permission for the persistent notification (API 33+).
                // Without this the FGS still runs but the notification
                // is silently suppressed, leaving the user with no
                // visible signal that the connection is alive.
                const granted = await requestNotificationPermission();
                if (!granted) {
                    Alert.alert(
                        "Notification permission needed",
                        "Always-on connection shows an ongoing notification while it's running. Grant notifications and try again.",
                    );
                    return;
                }
                await startAlwaysOn();
                Alert.alert(
                    "Battery optimization",
                    "For the connection to survive while your phone sleeps, exempt Vex from battery optimization on the next screen (Battery → Unrestricted).",
                    [
                        { style: "cancel", text: "Later" },
                        {
                            onPress: () => {
                                void openBatteryOptimizationSettings();
                            },
                            text: "Open settings",
                        },
                    ],
                );
            } else {
                await stopAlwaysOn();
            }
        } catch (err: unknown) {
            console.warn(
                "[vex-fgs] toggle failed",
                err instanceof Error ? err.message : String(err),
            );
        } finally {
            setAlwaysOnBusy(false);
        }
    }

    function handleLogout(): void {
        Alert.alert(
            "Sign out?",
            "Your messages stay encrypted on this device. You can sign back in anytime.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        setLoggingOut(true);
                        void (async () => {
                            try {
                                if (user?.userID) {
                                    try {
                                        await unsubscribeStoredPushNotificationSubscription(
                                            user.userID,
                                        );
                                    } catch (err: unknown) {
                                        console.warn(
                                            "[vex-push] pre-logout cleanup failed",
                                            err instanceof Error
                                                ? err.message
                                                : String(err),
                                        );
                                    }
                                }
                                await vexService.logout();
                            } catch {
                                /* ignore */
                            } finally {
                                setLoggingOut(false);
                            }
                        })();
                    },
                    style: "destructive",
                    text: "Sign out",
                },
            ],
        );
    }

    function handleResetUnreadCounts(): void {
        Alert.alert(
            "Reset unread counters?",
            "This only resets local unread badges on this device.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        vexService.resetAllUnread();
                        Alert.alert("Done", "Unread counters have been reset.");
                    },
                    text: "Reset",
                },
            ],
        );
    }

    const refreshAboutInfo = useCallback(
        async (options?: { forceUpdateCheck?: boolean; silent?: boolean }) => {
            if (aboutRefreshInFlightRef.current) {
                return;
            }
            aboutRefreshInFlightRef.current = true;
            const silent = options?.silent === true;
            try {
                if (!silent) {
                    setAboutRefreshing(true);
                }
                await checkForAppUpdates({
                    force: options?.forceUpdateCheck === true,
                    silent,
                });
            } finally {
                if (!silent) {
                    setAboutRefreshing(false);
                }
                aboutRefreshInFlightRef.current = false;
            }
        },
        [],
    );

    useEffect(() => {
        if (section !== "about" && section !== "developer") {
            return;
        }
        void refreshAboutInfo({ silent: true });
    }, [refreshAboutInfo, section, user?.userID]);

    async function handleManualUpdateCheck(): Promise<void> {
        if (updateBusy) return;
        setUpdateBusy(true);
        try {
            await refreshAboutInfo({ forceUpdateCheck: true });
        } finally {
            setUpdateBusy(false);
        }
    }

    async function handleFetchOtaUpdate(): Promise<void> {
        if (updateBusy) return;
        setUpdateBusy(true);
        try {
            const next = await fetchOtaUpdate();
            if (next.status === "ota_ready") {
                Alert.alert(
                    "Restart to update?",
                    "The OTA update is downloaded and will run after Vex restarts.",
                    [
                        { style: "cancel", text: "Later" },
                        {
                            onPress: () => {
                                void restartForOtaUpdate();
                            },
                            text: "Restart",
                        },
                    ],
                );
            }
        } catch (err: unknown) {
            Alert.alert("OTA update failed", errorMessage(err));
        } finally {
            setUpdateBusy(false);
        }
    }

    function handleDownloadApkUpdate(): void {
        const release = appUpdateState.nativeRelease;
        if (!release?.apkUrl) {
            Alert.alert("APK unavailable", "No APK asset was found.");
            return;
        }
        if (Platform.OS !== "android") {
            Alert.alert(
                "Open release?",
                "APK self-updates are Android-only. Open the GitHub release instead?",
                [
                    { style: "cancel", text: "Cancel" },
                    {
                        onPress: () => {
                            void downloadAndInstallApkUpdate();
                        },
                        text: "Open",
                    },
                ],
            );
            return;
        }
        Alert.alert(
            "Install APK update?",
            release.sha256
                ? "Vex will download the APK, verify its checksum, then open Android's installer."
                : "Vex will download the APK and open Android's installer. This release does not include a checksum yet.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void installApkUpdate();
                    },
                    text: "Install APK",
                },
            ],
        );
    }

    async function installApkUpdate(): Promise<void> {
        if (updateBusy) return;
        setUpdateBusy(true);
        try {
            await downloadAndInstallApkUpdate();
        } catch (err: unknown) {
            Alert.alert(
                "APK install failed",
                `${errorMessage(
                    err,
                )}\n\nIf Android blocks the install, allow Vex to install unknown apps and try again.`,
                [
                    { style: "cancel", text: "OK" },
                    {
                        onPress: () => {
                            void openUnknownAppSourcesSettings();
                        },
                        text: "Open settings",
                    },
                ],
            );
        } finally {
            setUpdateBusy(false);
        }
    }

    async function handleSelectLocalRetention(
        days: (typeof LOCAL_RETENTION_CHOICES)[number],
    ): Promise<void> {
        await persistLocalMessageRetentionDays(days);
        vexService.setLocalMessageRetentionDays(days);
    }

    function pushNotificationDescription(): string {
        if (!pushNotificationsEnabled) {
            return "Push notifications are off";
        }
        switch (pushNotificationStatus) {
            case "denied":
                return "Permission is blocked in system settings";
            case "error":
                return "Could not subscribe on this device";
            case "permission_needed":
                return "Waiting for notification permission";
            case "subscribed":
                return "Push notifications are active";
            case "subscribing":
                return "Subscribing this device...";
            default:
                return "Notify this device when new mail arrives";
        }
    }

    const latestReleaseVersion =
        appUpdateState.nativeRelease?.tagName?.match(/^mobile-v(.+)$/)?.[1] ??
        buildInfo.version;
    const latestShortCommit =
        appUpdateState.latestCommit?.shortSha ??
        appUpdateState.nativeRelease?.targetShortCommit;
    const latestVersionValue =
        latestShortCommit != null
            ? `${latestReleaseVersion}-${latestShortCommit}`
            : latestReleaseVersion;
    const latestVersionDescription =
        latestVersionValue !== "unknown"
            ? `Latest ${latestVersionValue}`
            : undefined;
    const isLatestVerified =
        appUpdateState.status === "current" &&
        commitsMatch(buildInfo.commit, appUpdateState.latestCommit?.sha);
    const aboutUpdateLoaded =
        appUpdateState.status !== "checking" &&
        appUpdateState.status !== "idle";
    const aboutUpdateLabel = aboutUpdateLoaded
        ? isLatestVerified
            ? "No updates available"
            : "Latest available"
        : "Software Update";
    const aboutUpdateDescription = aboutUpdateLoaded
        ? latestVersionDescription
        : appUpdateState.status === "checking"
          ? "Checking for updates..."
          : undefined;
    const versionTapDescription = devUnlocked
        ? "Developer options are unlocked"
        : versionTaps > 0
          ? `${DEV_UNLOCK_TAPS - versionTaps} more tap${
                DEV_UNLOCK_TAPS - versionTaps === 1 ? "" : "s"
            } to unlock developer options`
          : undefined;
    const homeserver = getServerUrl();
    const serverCount = Object.keys(servers).length;
    const channelCount = Object.values(channelsByServer).reduce(
        (total, channels) => total + channels.length,
        0,
    );

    function updateActionLabel(): string {
        switch (appUpdateState.status) {
            case "apk_available":
                return "Install APK";
            case "apk_downloading":
                return appUpdateState.apkDownloadProgress != null
                    ? `${String(
                          Math.round(appUpdateState.apkDownloadProgress * 100),
                      )}%`
                    : "Downloading";
            case "checking":
                return "Checking";
            case "ota_available":
                return "Install OTA";
            case "ota_ready":
                return "Restart";
            default:
                return "Check for Updates";
        }
    }

    function updateActionDisabled(): boolean {
        return (
            updateBusy ||
            appUpdateState.status === "checking" ||
            appUpdateState.status === "apk_downloading"
        );
    }

    function renderUpdateAccessory() {
        if (isLatestVerified) {
            return <VerifiedCheck />;
        }
        return (
            <InlineActionButton
                disabled={updateActionDisabled()}
                label={updateActionLabel()}
                onPress={handleUpdateRowPress}
            />
        );
    }

    function handleUpdateRowPress(): void {
        if (appUpdateState.status === "ota_available") {
            void handleFetchOtaUpdate();
            return;
        }
        if (appUpdateState.status === "ota_ready") {
            void restartForOtaUpdate();
            return;
        }
        if (appUpdateState.status === "apk_available") {
            handleDownloadApkUpdate();
            return;
        }
        void handleManualUpdateCheck();
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function readImageBytesFromBase64(base64Data: string): Uint8Array {
        const decode = globalThis.atob;
        if (typeof decode !== "function") {
            throw new Error("Base64 decoder is unavailable on this device.");
        }
        const binary = decode(base64Data.replace(/\s+/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    async function compressAvatarToLimit(
        sourceUri: string,
        maxBytes: number,
    ): Promise<{ data: null | Uint8Array; lastAttemptBytes: null | number }> {
        const TARGET_DIMENSION = 500;
        const QUALITY_STEPS: ReadonlyArray<number> = [0.34, 0.28, 0.22, 0.16];
        let lastAttemptBytes: null | number = null;

        for (const quality of QUALITY_STEPS) {
            // Force a predictable avatar payload size:
            // 1) hard resize to 500x500
            // 2) always encode as lossy JPEG
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Expo's new contextual API is not yet available in this pinned runtime.
            const manipulated = await ImageManipulator.manipulateAsync(
                sourceUri,
                [
                    {
                        resize: {
                            height: TARGET_DIMENSION,
                            width: TARGET_DIMENSION,
                        },
                    },
                ],
                {
                    base64: true,
                    compress: quality,
                    format: ImageManipulator.SaveFormat.JPEG,
                },
            );
            if (!manipulated.base64) {
                continue;
            }
            const bytes = readImageBytesFromBase64(manipulated.base64);
            lastAttemptBytes = bytes.byteLength;
            if (bytes.byteLength <= maxBytes) {
                return { data: bytes, lastAttemptBytes };
            }
        }
        return { data: null, lastAttemptBytes };
    }

    /**
     * Whether the picked asset is square (within 1px tolerance). The OS
     * cropper occasionally hands back a slightly-off-by-one rectangle
     * even when we ask for `aspect: [1, 1]`.
     */
    function isSquare(width: null | number, height: null | number): boolean {
        if (width == null || height == null) return false;
        return Math.abs(width - height) <= 1;
    }

    const uploadSquareUri = useCallback(
        async (sourceUri: string, originalBytes: number): Promise<void> => {
            setAvatarLastAttemptBytes(originalBytes);
            const compressed = await compressAvatarToLimit(
                sourceUri,
                MAX_AVATAR_BYTES,
            );
            setAvatarLastAttemptBytes(
                compressed.lastAttemptBytes ?? originalBytes,
            );
            const data = compressed.data;
            if (data == null) {
                setAvatarError(
                    "Could not process this image. Please try a different photo.",
                );
                return;
            }
            if (data.byteLength > MAX_AVATAR_BYTES) {
                setAvatarError(
                    `Still too large after compression. Current: ${formatBytes(
                        compressed.lastAttemptBytes ?? data.byteLength,
                    )}. Limit: ${formatBytes(MAX_AVATAR_BYTES)}.`,
                );
                return;
            }
            const sizeNote =
                originalBytes > 0 && data.byteLength < originalBytes
                    ? `Optimized from ${formatBytes(originalBytes)} to ${formatBytes(data.byteLength)} (500x500 JPEG).`
                    : `Processed as 500x500 JPEG (${formatBytes(data.byteLength)}).`;
            const result = await vexService.setAvatar(data);
            if (!result.ok) {
                setAvatarError(result.error ?? "Avatar upload failed.");
                return;
            }
            setAvatarNotice(sizeNote);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers and constants are stable
        [],
    );

    // Picks up a cropped image emitted by `AvatarCropScreen` and
    // continues the upload pipeline for it.
    useEffect(() => {
        if (!cropResult) return;
        const expected = expectedCropRequestRef.current;
        if (expected == null || cropResult.requestId !== expected) {
            return;
        }
        // Consume the result (single-shot).
        $avatarCropResult.set(null);
        expectedCropRequestRef.current = null;
        const cropUri = cropResult.uri;
        setAvatarError("");
        setAvatarNotice("");
        setAvatarLastAttemptBytes(null);
        setAvatarUploading(true);
        void (async () => {
            try {
                await uploadSquareUri(cropUri, 0);
            } catch (err: unknown) {
                setAvatarError(
                    err instanceof Error
                        ? err.message
                        : "Avatar upload failed.",
                );
            } finally {
                setAvatarUploading(false);
            }
        })();
    }, [cropResult, uploadSquareUri]);

    async function handlePickAvatar(): Promise<void> {
        if (!user?.userID || avatarUploading) {
            return;
        }
        const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            setAvatarError("Photo library permission is required.");
            return;
        }

        const pickerResult = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            // Tell the OS cropper we want a 1:1 result. iOS honors this
            // strictly; Android's cropper uses it as the initial aspect
            // but lets the user resize freely, so we still validate
            // afterwards and route through our in-app cropper if the
            // result isn't square.
            aspect: [1, 1],
            base64: true,
            quality: 0.92,
        });
        if (pickerResult.canceled) {
            return;
        }
        const asset = pickerResult.assets[0];
        if (!asset?.uri) {
            setAvatarError("No image selected.");
            return;
        }
        if (asset.type != null && asset.type !== "image") {
            setAvatarError("Please select an image.");
            return;
        }

        setAvatarError("");
        setAvatarNotice("");
        setAvatarLastAttemptBytes(null);

        const width = typeof asset.width === "number" ? asset.width : null;
        const height = typeof asset.height === "number" ? asset.height : null;

        // Non-square asset (the OS cropper was skipped or freeform-cropped).
        // Send the user through our in-app cropper to pick a square region.
        if (!isSquare(width, height) && width != null && height != null) {
            const requestId = Math.floor(Math.random() * 1_000_000_000);
            expectedCropRequestRef.current = requestId;
            // Pre-clear any stale cropper result (different request id, but
            // safer to start clean).
            $avatarCropResult.set(null);
            navigation.navigate("AvatarCrop", {
                sourceHeight: height,
                sourceUri: asset.uri,
                sourceWidth: width,
            });
            // The useEffect above will pick the result up and finish the
            // upload when the cropper screen returns.
            // We can't compare `requestId` directly to the cropper's id
            // since the cropper makes its own; we just gate on "is this
            // the most recent crop request we issued?".
            expectedCropRequestRef.current = null;
            return;
        }

        // Already square — upload directly.
        setAvatarUploading(true);
        try {
            const originalBytes =
                typeof asset.fileSize === "number" && asset.fileSize > 0
                    ? asset.fileSize
                    : asset.base64 != null
                      ? readImageBytesFromBase64(asset.base64).byteLength
                      : 0;
            await uploadSquareUri(asset.uri, originalBytes);
        } catch (err: unknown) {
            setAvatarError(
                err instanceof Error ? err.message : "Avatar upload failed.",
            );
        } finally {
            setAvatarUploading(false);
        }
    }

    return (
        <View style={styles.container}>
            <ChatHeader
                onBack={() => {
                    navigation.goBack();
                }}
                title={title}
            />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    section === "about" || section === "developer" ? (
                        <RefreshControl
                            onRefresh={() => {
                                void refreshAboutInfo({
                                    forceUpdateCheck: true,
                                });
                            }}
                            refreshing={aboutRefreshing}
                            tintColor={colors.textSecondary}
                        />
                    ) : undefined
                }
            >
                {section === "about" ? (
                    <>
                        <MenuSection title="App">
                            <MenuRow
                                description={versionTapDescription}
                                icon="pricetag-outline"
                                label="Version"
                                monoValue
                                onPress={handleVersionTap}
                                value={buildInfo.displayVersion}
                            />
                            <MenuRow
                                accessory={renderUpdateAccessory()}
                                description={aboutUpdateDescription}
                                icon={
                                    isLatestVerified
                                        ? "checkmark-circle-outline"
                                        : "cloud-download-outline"
                                }
                                label={aboutUpdateLabel}
                                onPress={
                                    isLatestVerified
                                        ? handleUpdateRowPress
                                        : undefined
                                }
                                tone={isLatestVerified ? "success" : "default"}
                            />
                            <MenuRow
                                icon="server-outline"
                                label="Homeserver"
                                monoValue
                                value={homeserver}
                            />
                        </MenuSection>
                    </>
                ) : null}

                {section === "account" ? (
                    <>
                        <MenuSection title="Profile">
                            <MenuRow
                                accessory={
                                    user?.userID ? (
                                        <Avatar
                                            displayName={user.username}
                                            size={40}
                                            userID={user.userID}
                                        />
                                    ) : null
                                }
                                description={
                                    avatarUploading
                                        ? "Uploading..."
                                        : "Tap to change profile image"
                                }
                                disabled={avatarUploading}
                                icon="image-outline"
                                label="Avatar"
                                onPress={() => {
                                    void handlePickAvatar();
                                }}
                                showChevron
                            />
                            {avatarError !== "" ? (
                                <View style={styles.statusCardError}>
                                    <Text style={styles.statusTitle}>
                                        Avatar upload issue
                                    </Text>
                                    <Text style={styles.errorText}>
                                        {avatarError}
                                    </Text>
                                    {avatarLastAttemptBytes != null ? (
                                        <Text style={styles.statusMeta}>
                                            Current:{" "}
                                            {formatBytes(
                                                avatarLastAttemptBytes,
                                            )}{" "}
                                            • Limit:{" "}
                                            {formatBytes(MAX_AVATAR_BYTES)}
                                        </Text>
                                    ) : null}
                                </View>
                            ) : null}
                            {avatarError === "" && avatarNotice !== "" ? (
                                <View style={styles.statusCardOk}>
                                    <Text style={styles.statusTitleOk}>
                                        Avatar updated
                                    </Text>
                                    <Text style={styles.statusMetaOk}>
                                        {avatarNotice}
                                    </Text>
                                </View>
                            ) : null}
                            <MenuRow
                                icon="at-outline"
                                label="Username"
                                value={user?.username ?? "—"}
                            />
                            <MenuRow
                                icon="finger-print-outline"
                                label="User ID"
                                monoBlock={user?.userID ?? "—"}
                            />
                        </MenuSection>

                        <MenuSection title="Memberships">
                            <MenuRow
                                icon="people-outline"
                                label="Groups"
                                value={String(serverCount)}
                            />
                            <MenuRow
                                icon="chatbubbles-outline"
                                label="Channels"
                                value={String(channelCount)}
                            />
                        </MenuSection>

                        <MenuSection title="Account">
                            <MenuRow
                                description="Disconnect and return to login"
                                disabled={loggingOut}
                                icon="log-out-outline"
                                label={
                                    loggingOut ? "Signing out..." : "Sign out"
                                }
                                onPress={handleLogout}
                                tone="danger"
                            />
                        </MenuSection>
                    </>
                ) : null}

                {section === "developer" && devUnlocked ? (
                    <>
                        <MenuSection title="Update diagnostics">
                            <MenuRow
                                icon="pricetag-outline"
                                label="Version"
                                monoValue
                                value={buildInfo.label}
                            />
                            <MenuRow
                                icon="git-commit-outline"
                                label="Commit"
                                monoBlock={buildInfo.commit}
                                value={buildInfo.shortCommit}
                            />
                            <MenuRow
                                description={
                                    buildInfo.isEmbeddedLaunch
                                        ? "Running the APK bundle"
                                        : "Running an OTA bundle"
                                }
                                icon={
                                    buildInfo.isEmbeddedLaunch
                                        ? "archive-outline"
                                        : "cloud-download-outline"
                                }
                                label="Update ID"
                                value={
                                    buildInfo.shortUpdateId ??
                                    (buildInfo.isEmbeddedLaunch
                                        ? "embedded"
                                        : "unknown")
                                }
                                {...(buildInfo.updateId != null
                                    ? { monoBlock: buildInfo.updateId }
                                    : {})}
                            />
                            <MenuRow
                                icon="git-branch-outline"
                                label="Channel"
                                value={buildInfo.channel}
                            />
                            <MenuRow
                                icon="finger-print-outline"
                                label="Fingerprint"
                                monoBlock={buildInfo.fingerprint}
                                value={buildInfo.shortFingerprint}
                            />
                            <MenuRow
                                icon="time-outline"
                                label="Created"
                                value={buildInfo.createdAt ?? "unknown"}
                            />
                            <MenuRow
                                icon="finger-print-outline"
                                label="Release fingerprint"
                                monoBlock={
                                    appUpdateState.nativeRelease?.fingerprint ??
                                    "unknown"
                                }
                                value={
                                    appUpdateState.nativeRelease
                                        ?.fingerprintShort ?? "unknown"
                                }
                            />
                            <MenuRow
                                icon="shield-checkmark-outline"
                                label="APK checksum"
                                monoBlock={
                                    appUpdateState.nativeRelease?.sha256 ??
                                    "unknown"
                                }
                                value={
                                    appUpdateState.nativeRelease?.sha256?.slice(
                                        0,
                                        8,
                                    ) ?? "unknown"
                                }
                            />
                        </MenuSection>
                        <MenuSection
                            footer="Logs print to the device terminal/logcat. Useful when reporting issues."
                            title="WebSocket Debug"
                        >
                            <MenuRow
                                accessory={
                                    <Switch
                                        onValueChange={(value) => {
                                            setWsDebugEnabled(value);
                                            vexService.setWebsocketDebug(value);
                                        }}
                                        value={wsDebugEnabled}
                                    />
                                }
                                description="Print inbound/outbound frames"
                                icon="code-slash-outline"
                                label="Debug logs"
                            />
                            <MenuRow
                                accessory={
                                    <Switch
                                        onValueChange={(value) => {
                                            setWsFrameDebugEnabled(value);
                                            vexService.setWebsocketFrameDebug(
                                                value,
                                            );
                                        }}
                                        value={wsFrameDebugEnabled}
                                    />
                                }
                                description="Log raw frame payloads"
                                icon="document-text-outline"
                                label="Frame payload logs"
                            />
                            <MenuRow
                                accessory={
                                    <Switch
                                        onValueChange={(value) => {
                                            setWsStateDebugEnabled(value);
                                            vexService.setWebsocketStateDebug(
                                                value,
                                            );
                                        }}
                                        value={wsStateDebugEnabled}
                                    />
                                }
                                description="Connect/disconnect/recover lifecycle"
                                icon="pulse-outline"
                                label="State transition logs"
                            />
                        </MenuSection>
                        <MenuSection
                            footer="Hides this menu again until you re-enter the easter egg in About."
                            title="Visibility"
                        >
                            <MenuRow
                                description="Hide developer options"
                                icon="lock-closed-outline"
                                label="Lock developer options"
                                onPress={handleLockDeveloperOptions}
                                tone="danger"
                            />
                        </MenuSection>
                    </>
                ) : null}

                {section === "notifications" ? (
                    <>
                        <MenuSection
                            footer="Push notifications wake the app so it can fetch encrypted mail from your inbox. Message contents stay encrypted on the server."
                            title="Push notifications"
                        >
                            <MenuRow
                                accessory={
                                    <Switch
                                        disabled={pushNotificationsBusy}
                                        onValueChange={(value) => {
                                            void handlePushNotificationsToggle(
                                                value,
                                            );
                                        }}
                                        value={pushNotificationsEnabled}
                                    />
                                }
                                description={pushNotificationDescription()}
                                icon="notifications-outline"
                                label="Push notifications"
                            />
                        </MenuSection>
                    </>
                ) : null}

                {section === "connection" ? (
                    <>
                        <MenuSection
                            footer="Keeps a persistent connection while the app is in the background. Shows an ongoing notification and uses extra battery — recommended only if push notifications aren't reliable on your device."
                            title="Always-on connection"
                        >
                            <MenuRow
                                accessory={
                                    <Switch
                                        disabled={alwaysOnBusy}
                                        onValueChange={(value) => {
                                            void handleAlwaysOnToggle(value);
                                        }}
                                        value={alwaysOn}
                                    />
                                }
                                description={
                                    alwaysOn
                                        ? "Background connection is active"
                                        : "Background connection is off"
                                }
                                icon="wifi-outline"
                                label="Always-on connection"
                            />
                        </MenuSection>
                        {alwaysOn ? (
                            <MenuSection
                                footer="Some manufacturers (Samsung, Xiaomi, Oppo, etc.) ship aggressive battery managers that override the system whitelist. If messages still stop arriving when the screen is off, see dontkillmyapp.com for OEM-specific instructions."
                                title="Reliability"
                            >
                                <MenuRow
                                    description="Allow Vex to run without battery limits"
                                    icon="battery-charging-outline"
                                    label="Battery optimization"
                                    onPress={() => {
                                        void openBatteryOptimizationSettings();
                                    }}
                                    showChevron
                                />
                            </MenuSection>
                        ) : null}
                    </>
                ) : null}

                {section === "data" ? (
                    <>
                        <MenuSection
                            footer="The server deletes undelivered mail after 30 days. Here you can keep fewer days on this device only. If another client sends a shorter retention hint, this device uses the shorter of your choice, that hint, and 30 days. A modified client could ignore hints."
                            title="Local message history"
                        >
                            {LOCAL_RETENTION_CHOICES.map((d) => (
                                <MenuRow
                                    accessory={
                                        d === localRetentionDays ? (
                                            <Ionicons
                                                color="rgba(255,255,255,0.85)"
                                                name="checkmark"
                                                size={22}
                                            />
                                        ) : undefined
                                    }
                                    description={
                                        d === localRetentionDays
                                            ? "Currently selected"
                                            : `Keep decrypted messages up to ${String(d)} days`
                                    }
                                    icon="time-outline"
                                    key={d}
                                    label={`${String(d)} days`}
                                    onPress={() => {
                                        void handleSelectLocalRetention(d);
                                    }}
                                />
                            ))}
                        </MenuSection>
                        <MenuSection title="Local Data">
                            <MenuRow
                                description="Clear all unread badges"
                                icon="refresh-outline"
                                label="Reset unread counters"
                                onPress={handleResetUnreadCounts}
                                tone="danger"
                            />
                        </MenuSection>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}

function commitsMatch(
    left: string | undefined,
    right: string | undefined,
): boolean {
    const a = normalizeCommit(left);
    const b = normalizeCommit(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function InlineActionButton({
    disabled,
    label,
    onPress,
}: {
    disabled: boolean;
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.inlineActionButton,
                pressed && styles.inlineActionButtonPressed,
                disabled && styles.inlineActionButtonDisabled,
            ]}
        >
            <Text style={styles.inlineActionText}>{label}</Text>
        </Pressable>
    );
}

function normalizeCommit(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim().toLowerCase();
    return /^[a-f0-9]{7,40}$/.test(trimmed) ? trimmed : undefined;
}

function VerifiedCheck() {
    return (
        <View style={styles.verifiedCheck}>
            <Ionicons color="#8DF5B0" name="checkmark-circle" size={18} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        gap: 18,
        paddingBottom: 24,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        fontSize: 12,
    },
    inlineActionButton: {
        backgroundColor: "rgba(74, 222, 128, 0.14)",
        borderColor: "rgba(74, 222, 128, 0.45)",
        borderRadius: 6,
        borderWidth: 1,
        minWidth: 128,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    inlineActionButtonDisabled: {
        opacity: 0.45,
    },
    inlineActionButtonPressed: {
        backgroundColor: "rgba(74, 222, 128, 0.22)",
        borderColor: "rgba(74, 222, 128, 0.62)",
    },
    inlineActionText: {
        ...typography.button,
        color: "#B5F5CD",
        fontSize: 12,
        textAlign: "center",
    },
    statusCardError: {
        backgroundColor: "rgba(229, 57, 53, 0.12)",
        borderColor: "rgba(229, 57, 53, 0.48)",
        borderRadius: 10,
        borderWidth: 1,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    statusCardOk: {
        backgroundColor: "rgba(74, 222, 128, 0.12)",
        borderColor: "rgba(74, 222, 128, 0.4)",
        borderRadius: 10,
        borderWidth: 1,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    statusMeta: {
        ...typography.body,
        color: "rgba(255,255,255,0.78)",
        fontSize: 12,
    },
    statusMetaOk: {
        ...typography.body,
        color: "rgba(255,255,255,0.8)",
        fontSize: 12,
    },
    statusTitle: {
        ...typography.button,
        color: "#FFD0CF",
        fontSize: 13,
        fontWeight: "700",
    },
    statusTitleOk: {
        ...typography.button,
        color: "#A7F3BD",
        fontSize: 13,
        fontWeight: "700",
    },
    verifiedCheck: {
        alignItems: "center",
        backgroundColor: "rgba(74,222,128,0.14)",
        borderColor: "rgba(74,222,128,0.45)",
        borderRadius: 999,
        borderWidth: 1,
        height: 30,
        justifyContent: "center",
        width: 30,
    },
});
