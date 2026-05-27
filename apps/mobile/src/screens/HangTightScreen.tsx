import type { AuthScreenProps } from "../navigation/types";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    Easing,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    Vibration,
    View,
} from "react-native";

import {
    $historyRecoveryStatus,
    $signedOutIntent,
    $user,
    vexService,
} from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { Avatar } from "../components/Avatar";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { getServerOptions } from "../lib/config";
import {
    clearAllCredentials,
    keychainKeyStore,
    listKnownAccounts,
} from "../lib/keychain";
import {
    cleanupLegacyLocalKeyMaterialArtifacts,
    mobileConfig,
} from "../lib/platform";
import { hydrateLocalMessageRetention } from "../lib/retentionPreference";
import { colors, typography } from "../theme";

interface PendingApprovalSnapshot {
    pendingRequestID: string;
    pendingSignKey?: string;
    /**
     * Existing user's ID when the server told us so. Lets the
     * "Is this you?" screen fetch their public avatar from the
     * unauthenticated `/avatar/:userID` endpoint. Optional because
     * older servers don't include it.
     */
    pendingUserID?: string;
    username: string;
}

type Phase = "boot" | "confirmExisting" | "error" | "form";
type RetryMode = "auth" | "passkeySetup";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,19}$/;

export function HangTightScreen({
    navigation,
    route,
}: AuthScreenProps<"HangTight">) {
    // `force: true` skips autoLogin and goes straight to the handle form —
    // used when the user explicitly chooses "Sign in with a different
    // account" or "Create an account" from a non-bootstrap entry point.
    const forceForm = route.params?.force === true;
    const fromAccountPicker = route.params?.fromAccountPicker === true;
    const _user = useStore($user);
    const historyRecoveryStatus = useStore($historyRecoveryStatus);
    const [bootError, setBootError] = useState("");
    const [busy, setBusy] = useState(true);
    const [username, setUsername] = useState("");
    const [phase, setPhase] = useState<Phase>("boot");
    const [retryMode, setRetryMode] = useState<RetryMode>("auth");
    const [focused, setFocused] = useState(false);
    const [pendingApproval, setPendingApproval] =
        useState<null | PendingApprovalSnapshot>(null);

    // ── Boot spinner animations (kept for the initial loading phase) ────────
    const spin = useMemo(() => new Animated.Value(0), []);
    const pulse = useMemo(() => new Animated.Value(1), []);
    const rotation = useMemo(
        () =>
            spin.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
            }),
        [spin],
    );

    // ── Form animations: fade/slide entrance + pulsing input glow ──────────
    const formOpacity = useRef(new Animated.Value(0)).current;
    const formY = useRef(new Animated.Value(20)).current;
    const inputGlow = useRef(new Animated.Value(0)).current;
    const buttonScale = useRef(new Animated.Value(1)).current;
    const errorShake = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        void cleanupLegacyLocalKeyMaterialArtifacts();
    }, []);

    useEffect(() => {
        Animated.loop(
            Animated.timing(spin, {
                duration: 3000,
                easing: Easing.linear,
                toValue: 1,
                useNativeDriver: true,
            }),
        ).start();

        Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    duration: 1000,
                    toValue: 1.1,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    duration: 1000,
                    toValue: 1,
                    useNativeDriver: true,
                }),
            ]),
        ).start();
    }, [spin, pulse]);

    useEffect(() => {
        if (phase !== "form" && phase !== "confirmExisting") {
            return;
        }
        formOpacity.setValue(0);
        formY.setValue(20);
        Animated.parallel([
            Animated.timing(formOpacity, {
                duration: 380,
                easing: Easing.out(Easing.quad),
                toValue: 1,
                useNativeDriver: true,
            }),
            Animated.spring(formY, {
                damping: 14,
                mass: 0.7,
                stiffness: 220,
                toValue: 0,
                useNativeDriver: true,
            }),
        ]).start();

        if (phase !== "form") {
            return;
        }
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(inputGlow, {
                    duration: 1400,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 1,
                    useNativeDriver: false,
                }),
                Animated.timing(inputGlow, {
                    duration: 1400,
                    easing: Easing.inOut(Easing.quad),
                    toValue: 0,
                    useNativeDriver: false,
                }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [phase, formOpacity, formY, inputGlow]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            // Explicit "switch account" / "create account" entries pass
            // force=true so we skip autoLogin and present the handle form.
            if (forceForm) {
                setBusy(false);
                setPhase("form");
                return;
            }

            // After an explicit sign-out we must NOT autoLogin from the
            // kept keychain credentials — that produced an immediate-resign
            // loop. Bounce to the account picker (or Welcome if no saved
            // accounts at all) and let the user choose where to go.
            if ($signedOutIntent.get() && !fromAccountPicker) {
                try {
                    const accounts = await listKnownAccounts();
                    if (cancelled) return;
                    navigation.replace(
                        accounts.length > 0 ? "AccountSelector" : "Welcome",
                    );
                } catch {
                    if (!cancelled) {
                        navigation.replace("Welcome");
                    }
                }
                return;
            }

            setBusy(true);
            setBootError("");
            setPhase("boot");
            try {
                await hydrateLocalMessageRetention();
                const result = await vexService.autoLogin(
                    keychainKeyStore,
                    mobileConfig(),
                    getServerOptions(),
                );
                if (cancelled) return;
                // No active credentials, or the auth flow just cleared
                // them because the server reported they no longer
                // authenticate (`requireReauth`: 401 expired session,
                // 404 device/user deleted server-side). In both cases
                // there is nothing to retry against — route straight
                // to the account picker (or the new-account form when
                // no other saved accounts exist). App.tsx already owns
                // the user-visible toast for the requireReauth case.
                const noActiveCreds =
                    !result.ok && (!result.error || result.requireReauth);
                if (noActiveCreds) {
                    const accounts = await listKnownAccounts();
                    if (cancelled) return;
                    if (accounts.length > 0) {
                        navigation.replace("AccountSelector");
                        return;
                    }
                    setPhase("form");
                } else if (!result.ok && result.passkeySetupRequired) {
                    setRetryMode("passkeySetup");
                    setBootError(
                        result.error ??
                            "Passkey setup did not finish. Tap Retry to continue.",
                    );
                    setPhase("error");
                } else if (!result.ok) {
                    setRetryMode("auth");
                    setBootError(
                        result.error ?? "Could not initialize account.",
                    );
                    setPhase("error");
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setBootError(
                        err instanceof Error
                            ? err.message
                            : "Could not initialize account.",
                    );
                    setPhase("error");
                }
            } finally {
                if (!cancelled) {
                    setBusy(false);
                }
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
        // navigation reference is stable from the Stack.Navigator but the
        // exhaustive-deps rule can't see that. Intentional empty deps —
        // we only want to run the bootstrap check once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromAccountPicker]);

    const playInvalidShake = () => {
        Vibration.vibrate(40);
        errorShake.setValue(0);
        Animated.sequence([
            Animated.timing(errorShake, {
                duration: 60,
                toValue: 1,
                useNativeDriver: true,
            }),
            Animated.timing(errorShake, {
                duration: 60,
                toValue: -1,
                useNativeDriver: true,
            }),
            Animated.timing(errorShake, {
                duration: 60,
                toValue: 0.5,
                useNativeDriver: true,
            }),
            Animated.timing(errorShake, {
                duration: 60,
                toValue: 0,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const handleSubmit = () => {
        if (busy) return;
        const candidate = username.trim();
        if (!HANDLE_PATTERN.test(candidate)) {
            setBootError("Handles are 3-19 letters, digits, or underscores.");
            playInvalidShake();
            return;
        }
        Keyboard.dismiss();
        Vibration.vibrate(20);
        Animated.sequence([
            Animated.timing(buttonScale, {
                duration: 80,
                toValue: 0.96,
                useNativeDriver: true,
            }),
            Animated.spring(buttonScale, {
                damping: 12,
                mass: 0.5,
                stiffness: 280,
                toValue: 1,
                useNativeDriver: true,
            }),
        ]).start();

        setBootError("");
        setBusy(true);
        void vexService
            .register(
                candidate,
                "",
                mobileConfig(),
                getServerOptions(),
                keychainKeyStore,
            )
            .then((result) => {
                if (!result.ok && result.passkeySetupRequired) {
                    setRetryMode("passkeySetup");
                    setBootError(
                        result.error ??
                            "Passkey setup did not finish. Tap Retry to continue.",
                    );
                    setPhase("error");
                    return;
                }
                if (
                    !result.ok &&
                    result.pendingDeviceApproval &&
                    result.pendingRequestID
                ) {
                    // Existing account picked up mid-signup. Don't jump
                    // straight into the approval-poll screen — it's
                    // confusing for users who didn't realize the handle
                    // was already taken. Show an "is this you?" gate
                    // first; only on confirm do we route to the
                    // Authenticate screen. The watcher started by
                    // vexService.register() keeps running in the
                    // background; if the user denies, we cancel it.
                    Vibration.vibrate(20);
                    setPendingApproval({
                        pendingRequestID: result.pendingRequestID,
                        ...(result.pendingSignKey !== undefined
                            ? { pendingSignKey: result.pendingSignKey }
                            : {}),
                        ...(result.pendingUserID !== undefined
                            ? { pendingUserID: result.pendingUserID }
                            : {}),
                        username: candidate,
                    });
                    setPhase("confirmExisting");
                    return;
                }
                if (!result.ok) {
                    setRetryMode("auth");
                    setBootError(result.error ?? "Could not sign in.");
                    playInvalidShake();
                }
            })
            .catch((err: unknown) => {
                setRetryMode("auth");
                setBootError(
                    err instanceof Error ? err.message : "Could not sign in.",
                );
                playInvalidShake();
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleConfirmExisting = () => {
        if (!pendingApproval || busy) {
            return;
        }
        Vibration.vibrate([0, 20, 40, 20]);
        setBusy(true);
        void vexService
            .publishDeferredDeviceApprovalAndStartWatching(keychainKeyStore)
            .then((published) => {
                if (!published.ok) {
                    setBootError(
                        published.error ??
                            "Could not notify your other devices. Try again.",
                    );
                    return;
                }
                setBootError("");
                const params = {
                    requestID: pendingApproval.pendingRequestID,
                    ...(pendingApproval.pendingSignKey !== undefined
                        ? { signKey: pendingApproval.pendingSignKey }
                        : {}),
                    username: pendingApproval.username,
                };
                setPendingApproval(null);
                navigation.replace("Authenticate", params);
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleDenyExisting = () => {
        if (busy) {
            return;
        }
        Vibration.vibrate(15);
        void (async () => {
            await vexService.abortDeferredDeviceApproval();
            vexService.cancelPendingApproval();
            setPendingApproval(null);
            setBootError("");
            setBusy(false);
            setRetryMode("auth");
            setUsername("");
            setPhase("form");
        })();
    };

    const handleRetry = () => {
        setBusy(true);
        setBootError("");
        setPhase("boot");
        const runRetry =
            retryMode === "passkeySetup"
                ? vexService.completeInitialPasskeySetup(mobileConfig())
                : (async () => {
                      await hydrateLocalMessageRetention();
                      return vexService.autoLogin(
                          keychainKeyStore,
                          mobileConfig(),
                          getServerOptions(),
                      );
                  })();
        void runRetry
            .then(async (result) => {
                if (result.ok) {
                    setRetryMode("auth");
                    return;
                }
                if (result.passkeySetupRequired) {
                    setRetryMode("passkeySetup");
                    setBootError(
                        result.error ??
                            "Passkey setup did not finish. Tap Retry to continue.",
                    );
                    setPhase("error");
                    return;
                }
                // Mirror the bootstrap path: a successful "no creds" or a
                // requireReauth result both belong on the picker/form, not
                // back in the error phase that dropped us here.
                const noActiveCreds =
                    !result.ok && (!result.error || result.requireReauth);
                if (noActiveCreds) {
                    const accounts = await listKnownAccounts();
                    if (accounts.length > 0) {
                        setRetryMode("auth");
                        navigation.replace("AccountSelector");
                        return;
                    }
                    setRetryMode("auth");
                    setPhase("form");
                    return;
                }
                if (!result.ok) {
                    setRetryMode("auth");
                    setBootError(
                        result.error ?? "Could not initialize account.",
                    );
                    setPhase("error");
                }
            })
            .catch((err: unknown) => {
                setRetryMode("auth");
                setBootError(
                    err instanceof Error
                        ? err.message
                        : "Could not initialize account.",
                );
                setPhase("error");
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleChooseAnotherAccount = () => {
        setRetryMode("auth");
        setBootError("");
        navigation.replace("AccountSelector");
    };

    const handleResetLocalAccounts = () => {
        if (busy) {
            return;
        }
        setBusy(true);
        void (async () => {
            await clearAllCredentials();
            setRetryMode("auth");
            setBootError("");
            setUsername("");
            setPhase("form");
        })()
            .catch((err: unknown) => {
                setBootError(
                    err instanceof Error
                        ? err.message
                        : "Could not remove saved account.",
                );
                setPhase("error");
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleValid = HANDLE_PATTERN.test(username.trim());
    const showHint = username.length > 0;
    const cornerColor = focused ? colors.accent : colors.border;

    const inputGlowOpacity = inputGlow.interpolate({
        inputRange: [0, 1],
        outputRange: focused ? [0.55, 0.85] : [0.18, 0.38],
    });
    const inputGlowScale = inputGlow.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.06],
    });
    const shakeX = errorShake.interpolate({
        inputRange: [-1, 1],
        outputRange: [-8, 8],
    });

    if (phase === "form") {
        return (
            <ScreenLayout style={styles.layout}>
                <View pointerEvents="none" style={styles.blackoutLayer} />
                <View pointerEvents="none" style={styles.glowTop} />
                <View pointerEvents="none" style={styles.glowBottom} />

                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    style={styles.formWrap}
                >
                    <ScrollView
                        bounces={false}
                        contentContainerStyle={styles.formScrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <Animated.View
                            style={[
                                styles.formContent,
                                {
                                    opacity: formOpacity,
                                    transform: [
                                        { translateY: formY },
                                        { translateX: shakeX },
                                    ],
                                },
                            ]}
                        >
                            <Animated.View
                                style={[
                                    styles.logoBlock,
                                    { transform: [{ scale: pulse }] },
                                ]}
                            >
                                <VexLogo showWordmark size={40} />
                            </Animated.View>

                            <Text style={styles.eyebrow}>SIGN IN</Text>
                            <Text style={styles.heading}>Welcome.</Text>
                            <Text style={styles.subheading}>
                                Enter your handle to sign in or create an
                                account.
                            </Text>

                            <View style={styles.inputArea}>
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        styles.inputGlow,
                                        {
                                            opacity: inputGlowOpacity,
                                            transform: [
                                                { scale: inputGlowScale },
                                            ],
                                        },
                                    ]}
                                />
                                <CornerBracketBox
                                    color={cornerColor}
                                    size={10}
                                    thickness={1.5}
                                >
                                    <View style={styles.inputRow}>
                                        <Text style={styles.atSign}>@</Text>
                                        <TextInput
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            editable={!busy}
                                            maxLength={19}
                                            onBlur={() => {
                                                setFocused(false);
                                            }}
                                            onChangeText={(text) => {
                                                // Usernames are case-
                                                // insensitive at the
                                                // protocol level; lowercase
                                                // as the user types so
                                                // they see exactly what
                                                // their handle will be
                                                // (and so the regex below
                                                // never has to consider
                                                // uppercase).
                                                setUsername(
                                                    text
                                                        .toLowerCase()
                                                        .replace(
                                                            /[^a-z0-9_]/g,
                                                            "",
                                                        ),
                                                );
                                                if (bootError) setBootError("");
                                            }}
                                            onFocus={() => {
                                                setFocused(true);
                                                Vibration.vibrate(8);
                                            }}
                                            onSubmitEditing={handleSubmit}
                                            placeholder="handle"
                                            placeholderTextColor={
                                                colors.mutedDark
                                            }
                                            returnKeyType="go"
                                            selectionColor={colors.accent}
                                            style={styles.input}
                                            value={username}
                                        />
                                        {showHint ? (
                                            <Text
                                                style={[
                                                    styles.checkMark,
                                                    handleValid
                                                        ? styles.checkOk
                                                        : styles.checkPending,
                                                ]}
                                            >
                                                {handleValid ? "✓" : "·"}
                                            </Text>
                                        ) : null}
                                    </View>
                                </CornerBracketBox>
                            </View>

                            <Text style={styles.hint}>
                                3-19 letters, digits, or underscores
                            </Text>

                            {bootError ? (
                                <View style={styles.errorBox}>
                                    <Text style={styles.errorText}>
                                        {bootError}
                                    </Text>
                                </View>
                            ) : null}

                            <Animated.View
                                style={{ transform: [{ scale: buttonScale }] }}
                            >
                                <VexButton
                                    disabled={
                                        busy || username.trim().length === 0
                                    }
                                    glow
                                    loading={busy}
                                    onPress={handleSubmit}
                                    style={styles.signInBtn}
                                    title={busy ? "Signing in..." : "Sign in"}
                                    variant="primary"
                                />
                            </Animated.View>

                            {!busy ? (
                                <Text style={styles.bottomHint}>
                                    We'll create an account if this handle is
                                    new, or sign you in if it's yours.
                                </Text>
                            ) : null}
                        </Animated.View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </ScreenLayout>
        );
    }

    if (phase === "confirmExisting" && pendingApproval) {
        return (
            <ScreenLayout style={styles.layout}>
                <View pointerEvents="none" style={styles.blackoutLayer} />
                <View pointerEvents="none" style={styles.glowTop} />
                <View pointerEvents="none" style={styles.glowBottom} />

                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    style={styles.formWrap}
                >
                    <ScrollView
                        bounces={false}
                        contentContainerStyle={styles.formScrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <Animated.View
                            style={[
                                styles.formContent,
                                {
                                    opacity: formOpacity,
                                    transform: [{ translateY: formY }],
                                },
                            ]}
                        >
                            <Animated.View
                                style={[
                                    styles.logoBlock,
                                    { transform: [{ scale: pulse }] },
                                ]}
                            >
                                <VexLogo showWordmark size={40} />
                            </Animated.View>

                            <Text style={styles.eyebrow}>EXISTING ACCOUNT</Text>
                            <Text style={styles.heading}>Is this you?</Text>
                            <Text style={styles.subheading}>
                                That handle is already registered. If it's
                                yours, we'll ask one of your other signed-in
                                devices to approve this one.
                            </Text>

                            <View style={styles.confirmAvatarWrap}>
                                <Avatar
                                    displayName={pendingApproval.username}
                                    // Older servers don't return the
                                    // existing user's ID with the
                                    // pending response — in that case
                                    // we fall through to the
                                    // initial/hue tile derived from the
                                    // username they just typed.
                                    fallbackOnly={
                                        pendingApproval.pendingUserID ===
                                        undefined
                                    }
                                    ring={{ color: colors.accent, width: 2 }}
                                    size={96}
                                    userID={pendingApproval.pendingUserID ?? ""}
                                />
                            </View>

                            <View style={styles.confirmHandleArea}>
                                <CornerBracketBox
                                    color={colors.accent}
                                    size={10}
                                    thickness={1.5}
                                >
                                    <View style={styles.confirmHandleRow}>
                                        <Text style={styles.atSign}>@</Text>
                                        <Text
                                            ellipsizeMode="tail"
                                            numberOfLines={1}
                                            style={styles.confirmHandleText}
                                        >
                                            {pendingApproval.username}
                                        </Text>
                                    </View>
                                </CornerBracketBox>
                            </View>

                            <View style={styles.confirmButtonStack}>
                                <VexButton
                                    disabled={busy}
                                    glow
                                    onPress={handleConfirmExisting}
                                    style={styles.confirmPrimary}
                                    title="Yes, that's me"
                                    variant="primary"
                                />
                                <VexButton
                                    disabled={busy}
                                    onPress={handleDenyExisting}
                                    style={styles.confirmSecondary}
                                    title="No, use a different handle"
                                    variant="outline"
                                />
                            </View>

                            <Text style={styles.bottomHint}>
                                {
                                    'Other devices are only notified after you tap "Yes". If this isn\u2019t you, nothing is sent — you can use a different handle.'
                                }
                            </Text>
                        </Animated.View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout>
            <View style={styles.bootContainer}>
                <Animated.Text
                    style={[
                        styles.icon,
                        { transform: [{ rotate: rotation }, { scale: pulse }] },
                    ]}
                >
                    ◈
                </Animated.Text>
                <Text style={styles.bootHeading}>Hang tight.</Text>
                <Text style={styles.bootSubtitle}>
                    {phase === "error"
                        ? "Something went sideways"
                        : historyRecoveryStatus === "recovering_local_history"
                          ? "Repairing local message history..."
                          : "We're getting your account ready"}
                </Text>
                {phase === "error" && bootError ? (
                    <View style={styles.errorWrap}>
                        <Text style={styles.errorText}>{bootError}</Text>
                        <VexButton
                            disabled={busy}
                            onPress={handleRetry}
                            title={busy ? "Retrying..." : "Retry"}
                            variant="outline"
                        />
                        <VexButton
                            disabled={busy}
                            onPress={handleChooseAnotherAccount}
                            title="Choose another account"
                            variant="outline"
                        />
                        <VexButton
                            disabled={busy}
                            onPress={handleResetLocalAccounts}
                            title="Reset local accounts"
                            variant="outline"
                        />
                    </View>
                ) : null}
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    atSign: {
        ...typography.bodyLarge,
        color: colors.muted,
        fontSize: 18,
        marginRight: 4,
    },
    blackoutLayer: {
        ...StyleSheet.absoluteFill,
        backgroundColor: "#000000",
        opacity: 0.72,
    },
    bootContainer: {
        alignItems: "center",
        flex: 1,
        gap: 12,
        justifyContent: "center",
    },
    bootHeading: {
        ...typography.heading,
        color: colors.text,
    },
    bootSubtitle: {
        ...typography.body,
        color: colors.muted,
    },
    bottomHint: {
        ...typography.body,
        color: "rgba(255,255,255,0.46)",
        fontSize: 11,
        marginTop: 18,
        textAlign: "center",
    },
    checkMark: {
        ...typography.button,
        fontSize: 18,
        marginLeft: 8,
    },
    checkOk: {
        color: "#22c55e",
    },
    checkPending: {
        color: colors.mutedDark,
    },
    confirmAvatarWrap: {
        alignItems: "center",
        marginTop: 22,
    },
    confirmButtonStack: {
        gap: 12,
        marginTop: 24,
    },
    confirmHandleArea: {
        marginTop: 16,
    },
    confirmHandleRow: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        flexDirection: "row",
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    confirmHandleText: {
        ...typography.bodyLarge,
        color: colors.text,
        flex: 1,
        fontSize: 18,
        letterSpacing: 0.5,
    },
    confirmPrimary: {
        width: "100%",
    },
    confirmSecondary: {
        width: "100%",
    },
    errorBox: {
        alignSelf: "stretch",
        backgroundColor: "rgba(229, 57, 53, 0.12)",
        borderColor: "rgba(229, 57, 53, 0.55)",
        borderWidth: 1,
        marginTop: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        textAlign: "center",
    },
    errorWrap: {
        alignItems: "center",
        gap: 10,
        marginTop: 14,
        maxWidth: 320,
    },
    eyebrow: {
        ...typography.label,
        color: "rgba(255,255,255,0.5)",
        marginTop: 18,
    },
    formContent: {
        alignSelf: "center",
        maxWidth: 460,
        paddingHorizontal: 8,
        width: "100%",
    },
    // ScrollView contentContainer that hosts the form. flexGrow:1 +
    // justifyContent:"center" preserves the "centered floating card"
    // feel on tall screens, while still letting the form scroll into
    // view when the keyboard or a small device shrinks the viewport
    // below the form's intrinsic height.
    formScrollContent: {
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: 24,
    },
    formWrap: {
        flex: 1,
        zIndex: 1,
    },
    glowBottom: {
        backgroundColor: colors.accent,
        borderRadius: 140,
        bottom: -50,
        height: 160,
        left: "20%",
        opacity: 0.1,
        position: "absolute",
        width: 160,
    },
    glowTop: {
        backgroundColor: colors.accent,
        borderRadius: 160,
        height: 180,
        opacity: 0.12,
        position: "absolute",
        right: -50,
        top: -60,
        width: 180,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
        marginTop: 6,
    },
    hint: {
        ...typography.body,
        color: "rgba(255,255,255,0.42)",
        fontSize: 11,
        marginTop: 10,
        textAlign: "center",
    },
    icon: {
        color: colors.accent,
        fontSize: 48,
        marginBottom: 24,
    },
    input: {
        color: colors.text,
        flex: 1,
        fontFamily: typography.bodyLarge.fontFamily,
        fontSize: 18,
        letterSpacing: 0.5,
        paddingVertical: 14,
    },
    inputArea: {
        marginTop: 22,
        position: "relative",
    },
    inputGlow: {
        backgroundColor: colors.accent,
        borderRadius: 18,
        bottom: -8,
        elevation: 18,
        left: -10,
        position: "absolute",
        right: -10,
        shadowColor: colors.accent,
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.75,
        shadowRadius: 28,
        top: -8,
    },
    inputRow: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        flexDirection: "row",
        paddingHorizontal: 14,
    },
    layout: {
        backgroundColor: "#000000",
    },
    logoBlock: {
        alignItems: "flex-start",
    },
    signInBtn: {
        marginTop: 20,
        width: "100%",
    },
    subheading: {
        ...typography.body,
        color: "rgba(255,255,255,0.66)",
        marginTop: 8,
    },
});
