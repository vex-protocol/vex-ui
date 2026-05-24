import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Animated,
    AppState,
    Easing,
    Linking,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { useStore } from "@nanostores/react";

import {
    $appUpdateState,
    type AppUpdateState,
    checkForAppUpdates,
    downloadAndInstallApkUpdate,
    fetchOtaUpdate,
    openUnknownAppSourcesSettings,
    restartForOtaUpdate,
} from "../lib/appUpdates";
import { buildInfo } from "../lib/buildInfo";
import { colors, typography } from "../theme";

type PrebootPhase =
    | "apk_downloading"
    | "apk_installing"
    | "checking"
    | "error"
    | "ota_downloading"
    | "ota_restarting"
    | "ready";

const CHECK_TIMEOUT_MS = 20_000;
const MIN_VISIBLE_MS = 800;

interface PrebootCopy {
    detail?: string | undefined;
    message: string;
    title: string;
}

export function PrebootSplash({
    children,
    detail,
    message,
    progress,
    title,
}: {
    children?: React.ReactNode;
    detail?: string | undefined;
    message: string;
    progress: number;
    title: string;
}) {
    const [spin] = useState(() => new Animated.Value(0));
    const [pulse] = useState(() => new Animated.Value(1));
    const [progressValue] = useState(
        () => new Animated.Value(clamp01(progress)),
    );
    const rotation = useMemo(
        () =>
            spin.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
            }),
        [spin],
    );
    const progressWidth = useMemo(
        () =>
            progressValue.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
            }),
        [progressValue],
    );

    useEffect(() => {
        const spinLoop = Animated.loop(
            Animated.timing(spin, {
                duration: 2800,
                easing: Easing.linear,
                toValue: 1,
                useNativeDriver: true,
            }),
        );
        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    duration: 1050,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 1.1,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    duration: 1050,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 1,
                    useNativeDriver: true,
                }),
            ]),
        );
        spinLoop.start();
        pulseLoop.start();
        return () => {
            spinLoop.stop();
            pulseLoop.stop();
        };
    }, [pulse, spin]);

    useEffect(() => {
        Animated.timing(progressValue, {
            duration: 360,
            easing: Easing.out(Easing.quad),
            toValue: clamp01(progress),
            useNativeDriver: false,
        }).start();
    }, [progress, progressValue]);

    return (
        <View style={styles.root}>
            <StatusBar barStyle="light-content" />
            <View pointerEvents="none" style={styles.gridLineTop} />
            <View pointerEvents="none" style={styles.gridLineBottom} />
            <View pointerEvents="none" style={styles.glowTop} />
            <View pointerEvents="none" style={styles.glowBottom} />

            <View style={styles.shell}>
                <Text style={styles.brand}>VEX</Text>
                <Animated.Text
                    style={[
                        styles.spinner,
                        {
                            transform: [{ rotate: rotation }, { scale: pulse }],
                        },
                    ]}
                >
                    ◈
                </Animated.Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.message}>{message}</Text>
                {detail ? <Text style={styles.detail}>{detail}</Text> : null}
                <View style={styles.progressTrack}>
                    <Animated.View
                        style={[styles.progressFill, { width: progressWidth }]}
                    />
                </View>
                <Text style={styles.version}>
                    {buildInfo.displayVersion} · {buildInfo.channel}
                </Text>
                {children}
            </View>
        </View>
    );
}

export function PrebootUpdateGate({ onComplete }: { onComplete: () => void }) {
    const appUpdateState = useStore($appUpdateState);
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState("");
    const [offlineContinueAllowed, setOfflineContinueAllowed] = useState(false);
    const [phase, setPhase] = useState<PrebootPhase>("checking");
    const completeRef = useRef(false);
    const visibleSinceRef = useRef(Date.now());

    const complete = useCallback(() => {
        if (completeRef.current) {
            return;
        }
        completeRef.current = true;
        setPhase("ready");
        const elapsed = Date.now() - visibleSinceRef.current;
        const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
        setTimeout(onComplete, delay);
    }, [onComplete]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            let blockingUpdateKnown = false;
            visibleSinceRef.current = Date.now();
            completeRef.current = false;
            setError("");
            setOfflineContinueAllowed(false);
            setPhase("checking");

            try {
                const state = await withTimeout(
                    checkForAppUpdates({ force: true }),
                    CHECK_TIMEOUT_MS,
                );
                if (cancelled) {
                    return;
                }

                switch (state.status) {
                    case "apk_available":
                        blockingUpdateKnown = true;
                        setPhase("apk_downloading");
                        await downloadAndInstallApkUpdate();
                        if (cancelled) {
                            return;
                        }
                        setPhase("apk_installing");
                        return;
                    case "current":
                    case "unsupported":
                        complete();
                        return;
                    case "error":
                        throw new Error(
                            state.error ?? "Could not verify app updates.",
                        );
                    case "apk_downloading":
                    case "checking":
                    case "idle":
                        complete();
                        return;
                    case "ota_available": {
                        blockingUpdateKnown = true;
                        setPhase("ota_downloading");
                        const fetched = await fetchOtaUpdate();
                        if (cancelled) {
                            return;
                        }
                        if (fetched.status !== "ota_ready") {
                            complete();
                            return;
                        }
                        setPhase("ota_restarting");
                        await restartForOtaUpdate();
                        return;
                    }
                    case "ota_ready":
                        blockingUpdateKnown = true;
                        setPhase("ota_restarting");
                        await restartForOtaUpdate();
                        return;
                }
            } catch (err: unknown) {
                if (cancelled) {
                    return;
                }
                setError(errorMessage(err));
                setOfflineContinueAllowed(!blockingUpdateKnown);
                setPhase("error");
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, [attempt, complete]);

    useEffect(() => {
        if (phase !== "apk_installing") {
            return;
        }
        const subscription = AppState.addEventListener("change", (next) => {
            if (next === "active") {
                setAttempt((value) => value + 1);
            }
        });
        return () => {
            subscription.remove();
        };
    }, [phase]);

    const progress = progressForPhase(phase, appUpdateState);
    const copy = copyForPhase(phase, appUpdateState, error);
    const canOpenRelease =
        appUpdateState.nativeRelease?.htmlUrl != null &&
        (phase === "apk_installing" || phase === "error");

    return (
        <PrebootSplash
            detail={copy.detail}
            message={copy.message}
            progress={progress}
            title={copy.title}
        >
            {phase === "apk_installing" ? (
                <View style={styles.actions}>
                    <PrimaryAction
                        label="Open installer"
                        onPress={() => {
                            void downloadAndInstallApkUpdate().catch(
                                () => undefined,
                            );
                        }}
                    />
                    <SecondaryAction
                        label="Check again"
                        onPress={() => {
                            setAttempt((value) => value + 1);
                        }}
                    />
                    <SecondaryAction
                        label="Install settings"
                        onPress={() => {
                            void openUnknownAppSourcesSettings();
                        }}
                    />
                </View>
            ) : null}

            {phase === "error" ? (
                <View style={styles.actions}>
                    <PrimaryAction
                        label="Retry"
                        onPress={() => {
                            setAttempt((value) => value + 1);
                        }}
                    />
                    {canOpenRelease ? (
                        <SecondaryAction
                            label="Open release"
                            onPress={() => {
                                const url =
                                    appUpdateState.nativeRelease?.htmlUrl;
                                if (url) {
                                    void Linking.openURL(url);
                                }
                            }}
                        />
                    ) : null}
                    {offlineContinueAllowed ? (
                        <SecondaryAction
                            label="Continue offline"
                            onPress={complete}
                        />
                    ) : null}
                </View>
            ) : null}
        </PrebootSplash>
    );
}

function apkDownloadMessage(state: AppUpdateState): string {
    const progress = state.apkDownloadProgress;
    if (typeof progress !== "number") {
        return "Fetching the latest native build.";
    }
    return `Fetching the latest native build (${String(
        Math.round(clamp01(progress) * 100),
    )}%).`;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function copyForPhase(
    phase: PrebootPhase,
    state: AppUpdateState,
    error: string,
): PrebootCopy {
    switch (phase) {
        case "apk_downloading":
            return {
                detail: state.nativeRelease?.targetShortCommit
                    ? `APK ${state.nativeRelease.targetShortCommit}. Keep Vex open.`
                    : "Keep Vex open while the APK downloads.",
                message: apkDownloadMessage(state),
                title: "Downloading APK",
            };
        case "apk_installing":
            return {
                detail: "Install the APK, then open Vex again. This gate will check again before loading chats.",
                message: "The Android installer should be open.",
                title: "Install update",
            };
        case "checking":
            return {
                detail: "Checking release channel before app startup.",
                message: "Making sure this build can safely open.",
                title: "Starting Vex",
            };
        case "error":
            return {
                detail: "Retry when network is available. Continue offline only skips this preboot check.",
                message: error || "Could not verify app updates.",
                title: "Update check failed",
            };
        case "ota_downloading":
            return {
                detail: state.latestCommit?.shortSha
                    ? `Preparing update ${state.latestCommit.shortSha}.`
                    : "Preparing a compatible update.",
                message: "Downloading the latest OTA bundle.",
                title: "Updating Vex",
            };
        case "ota_restarting":
            return {
                detail: "The app will reopen on the new code.",
                message: "Restarting into the downloaded update.",
                title: "Update ready",
            };
        case "ready":
            return {
                detail: "Opening secure app shell.",
                message: "Latest available code is ready.",
                title: "Opening Vex",
            };
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function PrimaryAction({
    label,
    onPress,
}: {
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable onPress={onPress} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>{label}</Text>
        </Pressable>
    );
}

function progressForPhase(phase: PrebootPhase, state: AppUpdateState): number {
    switch (phase) {
        case "apk_downloading":
            return 0.2 + clamp01(state.apkDownloadProgress ?? 0) * 0.76;
        case "apk_installing":
        case "ready":
            return 1;
        case "checking":
            return 0.18;
        case "error":
            return clamp01(state.apkDownloadProgress ?? 0);
        case "ota_downloading":
            return 0.58;
        case "ota_restarting":
            return 0.92;
    }
}

function SecondaryAction({
    label,
    onPress,
}: {
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable onPress={onPress} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>{label}</Text>
        </Pressable>
    );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Update check timed out."));
        }, timeoutMs);
        promise.then(resolve, reject).finally(() => {
            clearTimeout(timeout);
        });
    });
}

const styles = StyleSheet.create({
    actions: {
        alignItems: "center",
        gap: 10,
        marginTop: 22,
        width: "100%",
    },
    brand: {
        ...typography.label,
        color: "rgba(255,255,255,0.48)",
        letterSpacing: 3,
    },
    detail: {
        ...typography.body,
        color: "rgba(255,255,255,0.46)",
        maxWidth: 320,
        minHeight: 36,
        textAlign: "center",
    },
    glowBottom: {
        backgroundColor: colors.accent,
        borderRadius: 160,
        bottom: -72,
        height: 190,
        left: "12%",
        opacity: 0.1,
        position: "absolute",
        width: 190,
    },
    glowTop: {
        backgroundColor: colors.accent,
        borderRadius: 200,
        height: 220,
        opacity: 0.14,
        position: "absolute",
        right: -72,
        top: -86,
        width: 220,
    },
    gridLineBottom: {
        backgroundColor: "rgba(255,255,255,0.05)",
        bottom: "20%",
        height: 1,
        left: 0,
        position: "absolute",
        right: 0,
    },
    gridLineTop: {
        backgroundColor: "rgba(255,255,255,0.05)",
        height: 1,
        left: 0,
        position: "absolute",
        right: 0,
        top: "22%",
    },
    message: {
        ...typography.bodyLarge,
        color: "rgba(255,255,255,0.74)",
        maxWidth: 320,
        minHeight: 40,
        textAlign: "center",
    },
    primaryAction: {
        alignItems: "center",
        backgroundColor: colors.accent,
        borderColor: "rgba(255,255,255,0.18)",
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        maxWidth: 320,
        minHeight: 44,
        paddingHorizontal: 18,
        width: "100%",
    },
    primaryActionText: {
        ...typography.button,
        color: "#fff",
    },
    progressFill: {
        backgroundColor: colors.accent,
        borderRadius: 999,
        height: "100%",
        shadowColor: colors.accent,
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 12,
    },
    progressTrack: {
        backgroundColor: "rgba(255,255,255,0.12)",
        borderColor: "rgba(255,255,255,0.14)",
        borderRadius: 999,
        borderWidth: 1,
        height: 8,
        marginTop: 8,
        overflow: "hidden",
        width: "100%",
    },
    root: {
        alignItems: "center",
        backgroundColor: "#050506",
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 28,
    },
    secondaryAction: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.18)",
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        maxWidth: 320,
        minHeight: 42,
        paddingHorizontal: 18,
        width: "100%",
    },
    secondaryActionText: {
        ...typography.button,
        color: "rgba(255,255,255,0.78)",
    },
    shell: {
        alignItems: "center",
        gap: 12,
        maxWidth: 360,
        width: "100%",
    },
    spinner: {
        color: colors.accent,
        fontSize: 54,
        marginBottom: 4,
        marginTop: 6,
    },
    title: {
        ...typography.headingSmall,
        color: colors.text,
        textAlign: "center",
    },
    version: {
        ...typography.body,
        color: "rgba(255,255,255,0.38)",
        fontSize: 11,
        marginTop: 2,
        textAlign: "center",
    },
});
