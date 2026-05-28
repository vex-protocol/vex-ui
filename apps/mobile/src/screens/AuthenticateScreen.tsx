import type { AuthScreenProps } from "../navigation/types";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    Vibration,
    View,
} from "react-native";

import { $pendingApprovalStage, $user, vexService } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { BackButton } from "../components/BackButton";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { matchingCodeForSignKey } from "../lib/deviceApprovalCode";
import { isPasskeySupported } from "../lib/passkey";
import { colors, typography } from "../theme";

type Props = AuthScreenProps<"Authenticate">;

const EXPIRY_SECONDS = 5 * 60;
const APPROVE_GLOW = "rgba(74, 222, 128, 0.45)";
const AUTO_PASSKEY_SETUP_DELAY_MS = 900;
const SIGNING_BLUE = "#5DADE2";

type DisplayPhase =
    | "expired"
    | "failed"
    | "loading_account"
    | "passkey_setup"
    | "signing_in"
    | "waiting";

export function AuthenticateScreen({ navigation, route }: Props) {
    const user = useStore($user);
    const stage = useStore($pendingApprovalStage);
    const requestID = route.params?.requestID ?? null;
    const username = route.params?.username ?? null;
    const signKey = route.params?.signKey ?? null;
    const codeChars = matchingCodeForSignKey(signKey);
    const [secondsLeft, setSecondsLeft] = useState(EXPIRY_SECONDS);
    const [expired, setExpired] = useState(false);
    const [otherMethodsOpen, setOtherMethodsOpen] = useState(false);
    const [passkeySetupBusy, setPasskeySetupBusy] = useState(false);
    const [passkeySetupError, setPasskeySetupError] = useState<null | string>(
        null,
    );
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [restoreError, setRestoreError] = useState<null | string>(null);
    const autoPasskeySetupStarted = useRef(false);
    const passkeysSupported = isPasskeySupported();
    const footerBusy = restoreBusy || passkeySetupBusy;

    const phase: DisplayPhase = expired
        ? "expired"
        : stage === "failed"
          ? "failed"
          : stage === "loading_account" || user
            ? "loading_account"
            : stage === "passkey_setup"
              ? "passkey_setup"
              : stage === "signing_in"
                ? "signing_in"
                : "waiting";

    // Soft pulsing focus ring around the code while we're still waiting,
    // so it's clear the digits are "live" and to be matched against the
    // approver's screen.
    const halo = useMemo(() => new Animated.Value(0), []);
    useEffect(() => {
        if (phase !== "waiting") {
            halo.stopAnimation();
            halo.setValue(0);
            return;
        }
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(halo, {
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 1,
                    useNativeDriver: true,
                }),
                Animated.timing(halo, {
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 0,
                    useNativeDriver: true,
                }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [phase, halo]);

    // Countdown timer — only meaningful while waiting.
    useEffect(() => {
        if (phase !== "waiting") {
            return;
        }
        const timer = setInterval(() => {
            setSecondsLeft((s) => {
                if (s <= 1) {
                    clearInterval(timer);
                    setExpired(true);
                    return 0;
                }
                return s - 1;
            });
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [phase]);

    // Tactile cue at each big phase transition.
    useEffect(() => {
        if (phase === "signing_in") {
            Vibration.vibrate([0, 12, 40, 12]);
        } else if (phase === "loading_account") {
            Vibration.vibrate(20);
        }
    }, [phase]);

    const minutes = Math.floor(secondsLeft / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (secondsLeft % 60).toString().padStart(2, "0");
    const passkeySetupMessage = passkeysSupported
        ? "Vex will ask this device to save a passkey. Use your face, fingerprint, screen lock, or password manager to sign in and approve devices later."
        : "Passkeys aren't available on this device. We'll finish signing in if this server accepts the approved device key.";

    function goBackToSignIn(): void {
        navigation.replace("HangTight", { force: true });
    }

    async function restoreWithPasskey(): Promise<void> {
        if (!requestID || restoreBusy) {
            return;
        }
        setRestoreBusy(true);
        setRestoreError(null);
        const result = await vexService.passkeyRestorePendingDevice(requestID);
        if (!result.ok) {
            setRestoreError(
                result.error ?? "Could not restore this device with passkey.",
            );
            setRestoreBusy(false);
            return;
        }
        setOtherMethodsOpen(false);
        setRestoreBusy(false);
    }

    function confirmRestoreWithPasskey(): void {
        if (!passkeysSupported) {
            setRestoreError("Passkeys aren't available on this device.");
            return;
        }
        const account = username ? `@${username}` : "this account";
        Alert.alert(
            "Restore with passkey?",
            `This will make this phone the only device on ${account} and remove every other device from the account.`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void restoreWithPasskey();
                    },
                    style: "destructive",
                    text: "Restore with passkey",
                },
            ],
        );
    }

    const continueWithoutPasskey = useCallback(
        async (setupError?: string): Promise<void> => {
            setPasskeySetupBusy(true);
            setPasskeySetupError(null);
            try {
                const result =
                    await vexService.completePendingApprovalWithoutPasskey();
                if (!result.ok) {
                    const fallback =
                        result.error ??
                        "Create or use a passkey to finish signing in.";
                    setPasskeySetupError(
                        setupError ? `${setupError} ${fallback}` : fallback,
                    );
                }
            } finally {
                setPasskeySetupBusy(false);
            }
        },
        [],
    );

    const finishWithExistingPasskey = useCallback(async (): Promise<void> => {
        if (passkeySetupBusy) return;
        setPasskeySetupBusy(true);
        setPasskeySetupError(null);
        try {
            const result =
                await vexService.completePendingApprovalWithExistingPasskey();
            if (!result.ok) {
                setPasskeySetupError(
                    result.error ?? "Could not verify this device.",
                );
            }
        } finally {
            setPasskeySetupBusy(false);
        }
    }, [passkeySetupBusy]);

    const finishWithNewPasskey = useCallback(async (): Promise<void> => {
        if (passkeySetupBusy) return;
        setPasskeySetupBusy(true);
        setPasskeySetupError(null);
        try {
            const result =
                await vexService.completePendingApprovalWithNewPasskey(
                    "This device",
                );
            if (!result.ok) {
                await continueWithoutPasskey(
                    result.error ?? "Passkey setup was skipped.",
                );
            }
        } finally {
            setPasskeySetupBusy(false);
        }
    }, [continueWithoutPasskey, passkeySetupBusy]);

    useEffect(() => {
        if (phase !== "passkey_setup") {
            autoPasskeySetupStarted.current = false;
            return;
        }
        if (passkeySetupBusy || autoPasskeySetupStarted.current) {
            return;
        }

        autoPasskeySetupStarted.current = true;
        const timer = setTimeout(() => {
            if (passkeysSupported) {
                void finishWithNewPasskey();
            } else {
                void continueWithoutPasskey(
                    "Passkeys aren't available on this device.",
                );
            }
        }, AUTO_PASSKEY_SETUP_DELAY_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [
        continueWithoutPasskey,
        finishWithNewPasskey,
        passkeySetupBusy,
        passkeysSupported,
        phase,
    ]);

    const haloOpacity = halo.interpolate({
        inputRange: [0, 1],
        outputRange: [0.18, 0.55],
    });
    const haloScale = halo.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.04],
    });

    return (
        <ScreenLayout>
            <BackButton />

            <View style={styles.content}>
                <Text style={styles.label}>
                    {phase === "passkey_setup"
                        ? "DEVICE APPROVED"
                        : "VERIFICATION REQUIRED"}
                </Text>
                <Text style={styles.heading}>
                    {phase === "passkey_setup"
                        ? "Set up quicker sign-in."
                        : "Match This Code."}
                </Text>
                <Text style={styles.instructions}>
                    {phase === "passkey_setup"
                        ? passkeySetupMessage
                        : "The same four characters should appear on a device you're already signed in on. Tap Approve there to finish signing this device in."}
                </Text>

                <View style={styles.codeStage}>
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.halo,
                            {
                                opacity: haloOpacity,
                                transform: [{ scale: haloScale }],
                            },
                        ]}
                    />
                    <View style={styles.codeRow}>
                        {codeChars.map((char, i) => (
                            <CornerBracketBox
                                color={colors.error}
                                key={i}
                                size={6}
                                thickness={1.5}
                            >
                                <View style={styles.cell}>
                                    <Text style={styles.cellText}>{char}</Text>
                                </View>
                            </CornerBracketBox>
                        ))}
                    </View>
                </View>

                <Text style={styles.timer}>
                    {phase === "waiting"
                        ? `Expires in ${minutes}:${seconds}`
                        : phase === "expired"
                          ? "Verification window closed"
                          : phase === "failed"
                            ? "Sign-in needs retry"
                            : phase === "passkey_setup"
                              ? "Setting up sign-in"
                              : "Code matched"}
                </Text>

                {phase === "waiting" ? (
                    <View style={styles.statusCard}>
                        <ActivityIndicator
                            animating
                            color={colors.muted}
                            size="small"
                        />
                        <Text style={styles.statusText}>
                            Waiting for approval on your other device. That
                            device may ask for its passkey.
                        </Text>
                    </View>
                ) : null}

                {phase === "signing_in" ? (
                    <View style={[styles.statusCard, styles.statusCardActive]}>
                        <ActivityIndicator
                            animating
                            color={SIGNING_BLUE}
                            size="small"
                        />
                        <Text style={styles.statusTextActive}>
                            Signing in...
                        </Text>
                    </View>
                ) : null}

                {phase === "passkey_setup" ? (
                    <View
                        style={[
                            styles.statusCard,
                            styles.statusCardActive,
                            styles.passkeySetupCard,
                        ]}
                    >
                        <Text
                            style={[
                                styles.statusTextActive,
                                styles.passkeySetupText,
                            ]}
                        >
                            {passkeySetupBusy
                                ? "Waiting for device confirmation..."
                                : "Secure sign-in is ready."}
                        </Text>
                        {!passkeysSupported ? (
                            <Text style={styles.restoreError}>
                                Passkeys aren&apos;t available on this device.
                                You can add one later from Settings.
                            </Text>
                        ) : null}
                        {passkeySetupError ? (
                            <Text style={styles.restoreError}>
                                {passkeySetupError}
                            </Text>
                        ) : null}
                        {passkeysSupported && !passkeySetupError ? (
                            <View style={styles.passkeySetupStatusRow}>
                                <ActivityIndicator
                                    animating
                                    color={SIGNING_BLUE}
                                    size="small"
                                />
                                <Text style={styles.passkeySetupStatusText}>
                                    Your device will ask you to confirm.
                                </Text>
                            </View>
                        ) : null}
                        {passkeySetupError && passkeysSupported ? (
                            <>
                                <VexButton
                                    disabled={passkeySetupBusy}
                                    loading={passkeySetupBusy}
                                    onPress={() => {
                                        void finishWithNewPasskey();
                                    }}
                                    style={styles.methodButton}
                                    title="Create a passkey"
                                    variant="primary"
                                />
                                <VexButton
                                    disabled={passkeySetupBusy}
                                    onPress={() => {
                                        void finishWithExistingPasskey();
                                    }}
                                    style={styles.methodButton}
                                    title="Use a saved passkey"
                                    variant="outline"
                                />
                            </>
                        ) : null}
                    </View>
                ) : null}

                {phase === "loading_account" ? (
                    <View style={[styles.statusCard, styles.statusCardActive]}>
                        <ActivityIndicator
                            animating
                            color={SIGNING_BLUE}
                            size="small"
                        />
                        <Text style={styles.statusTextActive}>
                            Loading your account...
                        </Text>
                    </View>
                ) : null}

                {phase === "expired" ? (
                    <View style={styles.expiredCard}>
                        <Text style={styles.expiredTitle}>
                            This verification expired
                        </Text>
                        <Text style={styles.expiredBody}>
                            Approval wasn&apos;t confirmed in time. Start over
                            to request a fresh code.
                        </Text>
                    </View>
                ) : null}

                {phase === "failed" ? (
                    <View style={styles.expiredCard}>
                        <Text style={styles.expiredTitle}>
                            Approval could not finish
                        </Text>
                        <Text style={styles.expiredBody}>
                            The approval was received, but this phone could not
                            complete sign-in. Start over to request a fresh
                            code.
                        </Text>
                    </View>
                ) : null}
            </View>

            <View style={styles.footer}>
                {phase === "expired" || phase === "failed" ? (
                    <View style={styles.primaryButtonRow}>
                        <VexButton
                            glow
                            onPress={goBackToSignIn}
                            title="Retry verification"
                            variant="outline"
                        />
                    </View>
                ) : null}

                {phase === "waiting" ||
                phase === "expired" ||
                phase === "passkey_setup" ? (
                    <>
                        {phase === "waiting" && requestID ? (
                            <TouchableOpacity
                                activeOpacity={0.7}
                                disabled={restoreBusy}
                                hitSlop={{
                                    bottom: 12,
                                    left: 12,
                                    right: 12,
                                    top: 12,
                                }}
                                onPress={() => {
                                    setRestoreError(null);
                                    setOtherMethodsOpen(true);
                                }}
                                style={[
                                    styles.linkRow,
                                    restoreBusy && styles.linkDisabled,
                                ]}
                            >
                                <Text style={styles.linkText}>
                                    Other methods
                                </Text>
                            </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity
                            activeOpacity={0.7}
                            disabled={footerBusy}
                            hitSlop={{
                                bottom: 12,
                                left: 12,
                                right: 12,
                                top: 12,
                            }}
                            onPress={goBackToSignIn}
                            style={[
                                styles.linkRow,
                                footerBusy && styles.linkDisabled,
                            ]}
                        >
                            <Text style={styles.linkArrow}>‹</Text>
                            <Text style={styles.linkText}>Back to sign in</Text>
                        </TouchableOpacity>
                    </>
                ) : null}
            </View>

            <Modal
                animationType="fade"
                onRequestClose={() => {
                    if (!restoreBusy) {
                        setOtherMethodsOpen(false);
                    }
                }}
                transparent
                visible={otherMethodsOpen}
            >
                <Pressable
                    onPress={() => {
                        if (!restoreBusy) {
                            setOtherMethodsOpen(false);
                        }
                    }}
                    style={styles.modalBackdrop}
                >
                    <Pressable
                        onPress={() => undefined}
                        style={styles.methodPanel}
                    >
                        <Text style={styles.modalLabel}>OTHER METHODS</Text>
                        <Text style={styles.modalHeading}>
                            Restore this device
                        </Text>
                        <Text style={styles.modalBody}>
                            Use a passkey for{" "}
                            {username ? `@${username}` : "this account"} to
                            restore this phone as a new device and remove every
                            other device from the account.
                        </Text>

                        {!passkeysSupported ? (
                            <Text style={styles.restoreError}>
                                Passkeys aren&apos;t available on this device.
                            </Text>
                        ) : null}

                        {restoreError ? (
                            <Text style={styles.restoreError}>
                                {restoreError}
                            </Text>
                        ) : null}

                        <VexButton
                            disabled={!passkeysSupported || restoreBusy}
                            loading={restoreBusy}
                            onPress={confirmRestoreWithPasskey}
                            style={styles.methodButton}
                            title="Restore with passkey"
                            variant="primary"
                        />

                        <TouchableOpacity
                            activeOpacity={0.7}
                            disabled={restoreBusy}
                            hitSlop={{
                                bottom: 12,
                                left: 12,
                                right: 12,
                                top: 12,
                            }}
                            onPress={() => {
                                setOtherMethodsOpen(false);
                            }}
                            style={[
                                styles.modalCancel,
                                restoreBusy && styles.linkDisabled,
                            ]}
                        >
                            <Text style={styles.linkText}>Cancel</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </Modal>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    cell: {
        alignItems: "center",
        backgroundColor: "rgba(229, 57, 53, 0.08)",
        borderColor: "rgba(229, 57, 53, 0.4)",
        borderWidth: 1,
        height: 64,
        justifyContent: "center",
        width: 56,
    },
    cellText: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 28,
        letterSpacing: 1,
    },
    codeRow: {
        flexDirection: "row",
        gap: 12,
        justifyContent: "center",
    },
    codeStage: {
        alignItems: "center",
        justifyContent: "center",
        marginTop: 12,
        paddingVertical: 16,
    },
    content: {
        flex: 1,
        gap: 14,
        marginTop: 32,
    },
    expiredBody: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: "center",
    },
    expiredCard: {
        alignItems: "center",
        backgroundColor: "rgba(229, 57, 53, 0.10)",
        borderColor: "rgba(229, 57, 53, 0.4)",
        borderWidth: 1,
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    expiredTitle: {
        ...typography.body,
        color: colors.error,
        fontWeight: "600",
    },
    footer: {
        alignItems: "center",
        gap: 12,
        paddingBottom: 24,
    },
    halo: {
        backgroundColor: APPROVE_GLOW,
        borderRadius: 50,
        height: 92,
        position: "absolute",
        width: 320,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
    },
    instructions: {
        ...typography.body,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
    linkArrow: {
        ...typography.body,
        color: colors.accent,
        fontSize: 18,
        marginTop: -2,
    },
    linkDisabled: {
        opacity: 0.45,
    },
    linkRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    linkText: {
        ...typography.body,
        color: colors.accent,
        textDecorationColor: colors.accent,
        textDecorationLine: "underline",
        textDecorationStyle: "dotted",
    },
    methodButton: {
        alignSelf: "stretch",
    },
    methodPanel: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 14,
        maxWidth: 360,
        paddingHorizontal: 20,
        paddingVertical: 20,
        width: "88%",
    },
    modalBackdrop: {
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.72)",
        flex: 1,
        justifyContent: "center",
        padding: 18,
    },
    modalBody: {
        ...typography.bodyLarge,
        color: colors.textSecondary,
    },
    modalCancel: {
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    modalHeading: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 24,
        lineHeight: 30,
    },
    modalLabel: {
        ...typography.label,
        color: colors.muted,
    },
    passkeySetupCard: {
        alignItems: "stretch",
        flexDirection: "column",
    },
    passkeySetupStatusRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        paddingVertical: 4,
    },
    passkeySetupStatusText: {
        ...typography.body,
        color: "#D4ECFB",
        flexShrink: 1,
    },
    passkeySetupText: {
        flex: 0,
        textAlign: "center",
    },
    primaryButtonRow: {
        alignItems: "center",
    },
    restoreError: {
        ...typography.body,
        backgroundColor: "rgba(229, 57, 53, 0.10)",
        borderColor: "rgba(229, 57, 53, 0.4)",
        borderWidth: 1,
        color: colors.error,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    statusCard: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    statusCardActive: {
        backgroundColor: "rgba(93, 173, 226, 0.10)",
        borderColor: "rgba(93, 173, 226, 0.45)",
    },
    statusText: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
    },
    statusTextActive: {
        ...typography.body,
        color: "#D4ECFB",
        flex: 1,
        fontWeight: "600",
    },
    timer: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
});
