import type { AuthScreenProps } from "../navigation/types";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    Easing,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
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

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";

import { BackButton } from "../components/BackButton";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { getServerOptions } from "../lib/config";
import { keychainKeyStore, listKnownAccounts } from "../lib/keychain";
import { mobileConfig } from "../lib/platform";
import { hydrateLocalMessageRetention } from "../lib/retentionPreference";
import { colors, typography, useAccentColors } from "../theme";

type Phase = "boot" | "form";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,19}$/;

export function HangTightScreen({
    navigation,
    route,
}: AuthScreenProps<"HangTight">) {
    const accent = useAccentColors();
    // `force: true` skips autoLogin and goes straight to the handle form —
    // used when the user explicitly chooses "Sign in with a different
    // account" or "Create an account" from a non-bootstrap entry point.
    const forceForm = route.params?.force === true;
    const fromAccountPicker = route.params?.fromAccountPicker === true;
    const mode = route.params?.mode ?? "signin";
    const isCreatingAccount = mode === "signup";
    const initialUsername = route.params?.username?.toLowerCase() ?? "";
    const notice = route.params?.notice ?? "";
    const _user = useStore($user);
    const historyRecoveryStatus = useStore($historyRecoveryStatus);
    const [bootError, setBootError] = useState("");
    const [busy, setBusy] = useState(true);
    const [username, setUsername] = useState(initialUsername);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [phase, setPhase] = useState<Phase>("boot");
    const [focused, setFocused] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [confirmationFocused, setConfirmationFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

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

    // ── Form animations: a short fade/slide entrance ──────────────────────
    const formOpacity = useRef(new Animated.Value(0)).current;
    const formY = useRef(new Animated.Value(20)).current;
    const buttonScale = useRef(new Animated.Value(1)).current;
    const errorShake = useRef(new Animated.Value(0)).current;
    const passwordInputRef = useRef<TextInput>(null);
    const confirmationInputRef = useRef<TextInput>(null);

    const replaceWithAccountSelector = (error?: string) => {
        if (error) {
            navigation.replace("AccountSelector", { error });
            return;
        }
        navigation.replace("AccountSelector");
    };

    useEffect(() => {
        if (initialUsername.length > 0) {
            setUsername(initialUsername);
        }
    }, [initialUsername]);

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
        if (phase !== "form") {
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
    }, [phase, formOpacity, formY]);

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
                    navigation.replace("Welcome");
                } else if (!result.ok) {
                    replaceWithAccountSelector(
                        result.error ?? "Could not initialize account.",
                    );
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    replaceWithAccountSelector(
                        err instanceof Error
                            ? err.message
                            : "Could not initialize account.",
                    );
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

    const handlePasskeySubmit = () => {
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
        void (async () => {
            const passkey = await vexService.authenticateAccountWithPasskey(
                candidate,
                mobileConfig(),
                getServerOptions(),
                keychainKeyStore,
            );
            if (passkey.ok && passkey.username) {
                navigation.replace("ProvisionDevice", {
                    hasLocalDevice: passkey.hasLocalDevice === true,
                    ...(passkey.userID !== undefined
                        ? { userID: passkey.userID }
                        : {}),
                    username: passkey.username,
                });
                return;
            }
            if (passkey.userCancelled || passkey.networkError) {
                setBootError(
                    passkey.userCancelled
                        ? "Passkey sign-in was cancelled."
                        : (passkey.error ?? "Could not sign in with passkey."),
                );
                playInvalidShake();
                return;
            }

            setBootError(
                passkey.error ??
                    "No passkey found for this account. Enter your password instead.",
            );
            playInvalidShake();
        })()
            .catch((err: unknown) => {
                setBootError(
                    err instanceof Error ? err.message : "Could not sign in.",
                );
                playInvalidShake();
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleSubmit = () => {
        if (busy) return;
        const candidate = username.trim();
        const passwordCandidate = password;
        if (!HANDLE_PATTERN.test(candidate)) {
            setBootError("Handles are 3-19 letters, digits, or underscores.");
            playInvalidShake();
            return;
        }
        if (passwordCandidate.length === 0) {
            setBootError("Enter your password.");
            playInvalidShake();
            return;
        }
        if (isCreatingAccount && passwordCandidate.length < 15) {
            setBootError("Password must be at least 15 characters.");
            playInvalidShake();
            return;
        }
        if (isCreatingAccount && confirmPassword !== passwordCandidate) {
            setBootError("Passwords do not match.");
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
        const auth = isCreatingAccount
            ? vexService.register(
                  candidate,
                  passwordCandidate,
                  mobileConfig(),
                  getServerOptions(),
                  keychainKeyStore,
              )
            : fromAccountPicker
              ? vexService.login(
                    candidate,
                    passwordCandidate,
                    mobileConfig(),
                    getServerOptions(),
                    keychainKeyStore,
                )
              : vexService.requestDeviceEnrollment(
                    candidate,
                    passwordCandidate,
                    mobileConfig(),
                    getServerOptions(),
                    keychainKeyStore,
                );
        void auth
            .then(async (result) => {
                if (
                    !result.ok &&
                    result.pendingDeviceApproval &&
                    result.pendingRequestID
                ) {
                    if (!fromAccountPicker) {
                        const published =
                            await vexService.publishDeferredDeviceApprovalAndStartWatching(
                                keychainKeyStore,
                            );
                        if (!published.ok) {
                            setBootError(
                                published.error ??
                                    "Could not notify your other devices. Try again.",
                            );
                            playInvalidShake();
                            return;
                        }
                    }
                    navigation.replace("Authenticate", {
                        requestID: result.pendingRequestID,
                        ...(result.pendingSignKey !== undefined
                            ? { signKey: result.pendingSignKey }
                            : {}),
                        username: candidate,
                    });
                    return;
                }
                if (!result.ok) {
                    setBootError(result.error ?? "Could not continue.");
                    playInvalidShake();
                    return;
                }
            })
            .catch((err: unknown) => {
                setBootError(
                    err instanceof Error ? err.message : "Could not continue.",
                );
                playInvalidShake();
            })
            .finally(() => {
                setBusy(false);
            });
    };

    const handleValid = HANDLE_PATTERN.test(username.trim());
    const showHint = username.length > 0;
    const shakeX = errorShake.interpolate({
        inputRange: [-1, 1],
        outputRange: [-8, 8],
    });

    if (phase === "form") {
        return (
            <ScreenLayout style={styles.layout}>
                {forceForm && navigation.canGoBack() ? (
                    <View style={styles.backButton}>
                        <BackButton />
                    </View>
                ) : null}

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

                            <Text style={styles.eyebrow}>
                                {isCreatingAccount
                                    ? "CREATE ACCOUNT"
                                    : "SIGN IN"}
                            </Text>
                            <Text style={styles.heading}>
                                {isCreatingAccount
                                    ? "Join Vex."
                                    : "Welcome back."}
                            </Text>
                            <Text style={styles.subheading}>
                                {isCreatingAccount
                                    ? "Choose a handle and a password of 15 or more characters. You can add a passkey later."
                                    : "Enter your handle and password, or use a passkey already added to your account."}
                            </Text>

                            {notice ? (
                                <View style={styles.noticeBox}>
                                    <Text style={styles.noticeText}>
                                        {notice}
                                    </Text>
                                </View>
                            ) : null}

                            <View style={styles.inputArea}>
                                <View
                                    style={[
                                        styles.inputFrame,
                                        focused && {
                                            borderColor: accent.accent,
                                        },
                                    ]}
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
                                            onSubmitEditing={() => {
                                                passwordInputRef.current?.focus();
                                            }}
                                            placeholder="handle"
                                            placeholderTextColor={
                                                colors.mutedDark
                                            }
                                            returnKeyType="next"
                                            selectionColor={accent.accent}
                                            style={styles.input}
                                            submitBehavior="submit"
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
                                </View>
                            </View>

                            <Text style={styles.hint}>
                                3-19 letters, digits, or underscores
                            </Text>

                            <View style={styles.passwordArea}>
                                <View
                                    style={[
                                        styles.inputFrame,
                                        passwordFocused && {
                                            borderColor: accent.accent,
                                        },
                                    ]}
                                >
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            autoCapitalize="none"
                                            autoComplete={
                                                isCreatingAccount
                                                    ? "new-password"
                                                    : "current-password"
                                            }
                                            autoCorrect={false}
                                            editable={!busy}
                                            maxLength={1024}
                                            onBlur={() => {
                                                setPasswordFocused(false);
                                            }}
                                            onChangeText={(text) => {
                                                setPassword(text);
                                                if (bootError) setBootError("");
                                            }}
                                            onFocus={() => {
                                                setPasswordFocused(true);
                                                Vibration.vibrate(8);
                                            }}
                                            onSubmitEditing={() => {
                                                if (isCreatingAccount) {
                                                    confirmationInputRef.current?.focus();
                                                    return;
                                                }
                                                handleSubmit();
                                            }}
                                            placeholder="password"
                                            placeholderTextColor={
                                                colors.mutedDark
                                            }
                                            ref={passwordInputRef}
                                            returnKeyType={
                                                isCreatingAccount
                                                    ? "next"
                                                    : "go"
                                            }
                                            secureTextEntry={!showPassword}
                                            selectionColor={accent.accent}
                                            style={styles.input}
                                            textContentType={
                                                isCreatingAccount
                                                    ? "newPassword"
                                                    : "password"
                                            }
                                            value={password}
                                        />
                                        <Pressable
                                            accessibilityLabel={
                                                showPassword
                                                    ? "Hide password"
                                                    : "Show password"
                                            }
                                            accessibilityRole="button"
                                            hitSlop={8}
                                            onPress={() => {
                                                setShowPassword(
                                                    (shown) => !shown,
                                                );
                                            }}
                                            style={styles.passwordToggle}
                                        >
                                            <Ionicons
                                                color={colors.muted}
                                                name={
                                                    showPassword
                                                        ? "eye-off-outline"
                                                        : "eye-outline"
                                                }
                                                size={20}
                                            />
                                        </Pressable>
                                    </View>
                                </View>
                            </View>

                            {isCreatingAccount ? (
                                <View style={styles.passwordArea}>
                                    <View
                                        style={[
                                            styles.inputFrame,
                                            confirmationFocused && {
                                                borderColor: accent.accent,
                                            },
                                        ]}
                                    >
                                        <View style={styles.inputRow}>
                                            <TextInput
                                                autoCapitalize="none"
                                                autoComplete="new-password"
                                                autoCorrect={false}
                                                editable={!busy}
                                                maxLength={1024}
                                                onBlur={() => {
                                                    setConfirmationFocused(
                                                        false,
                                                    );
                                                }}
                                                onChangeText={(text) => {
                                                    setConfirmPassword(text);
                                                    if (bootError) {
                                                        setBootError("");
                                                    }
                                                }}
                                                onFocus={() => {
                                                    setConfirmationFocused(
                                                        true,
                                                    );
                                                    Vibration.vibrate(8);
                                                }}
                                                onSubmitEditing={handleSubmit}
                                                placeholder="confirm password"
                                                placeholderTextColor={
                                                    colors.mutedDark
                                                }
                                                ref={confirmationInputRef}
                                                returnKeyType="go"
                                                secureTextEntry={!showPassword}
                                                selectionColor={accent.accent}
                                                style={styles.input}
                                                textContentType="newPassword"
                                                value={confirmPassword}
                                            />
                                        </View>
                                    </View>
                                </View>
                            ) : null}

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
                                    loading={busy}
                                    onPress={handleSubmit}
                                    style={styles.signInBtn}
                                    title={
                                        busy
                                            ? isCreatingAccount
                                                ? "Creating account..."
                                                : "Signing in..."
                                            : isCreatingAccount
                                              ? "Create account"
                                              : "Sign in"
                                    }
                                    variant="primary"
                                />
                                {!isCreatingAccount ? (
                                    <>
                                        <VexButton
                                            disabled={
                                                busy ||
                                                username.trim().length === 0
                                            }
                                            icon="key-outline"
                                            onPress={handlePasskeySubmit}
                                            style={styles.passkeyBtn}
                                            title="Use passkey"
                                            variant="outline"
                                        />
                                        <Pressable
                                            accessibilityRole="button"
                                            disabled={busy}
                                            onPress={() => {
                                                navigation.navigate(
                                                    "RecoverPassword",
                                                    username.trim()
                                                        ? {
                                                              username:
                                                                  username.trim(),
                                                          }
                                                        : undefined,
                                                );
                                            }}
                                            style={styles.forgotButton}
                                        >
                                            <Text
                                                style={[
                                                    styles.forgotText,
                                                    {
                                                        color: accent.accentText,
                                                    },
                                                ]}
                                            >
                                                Forgot password?
                                            </Text>
                                        </Pressable>
                                    </>
                                ) : null}
                            </Animated.View>

                            {!busy ? (
                                <Text style={styles.bottomHint}>
                                    {isCreatingAccount
                                        ? "Already have an account? Go back and choose Sign in."
                                        : "Signing in on a new device may require approval from one of your existing devices."}
                                </Text>
                            ) : null}
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
                        { color: accent.accentText },
                        { transform: [{ rotate: rotation }, { scale: pulse }] },
                    ]}
                >
                    ◈
                </Animated.Text>
                <Text style={styles.bootHeading}>Hang tight.</Text>
                <Text style={styles.bootSubtitle}>
                    {historyRecoveryStatus === "recovering_local_history"
                        ? "Repairing local message history..."
                        : "We're getting your account ready"}
                </Text>
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
    backButton: {
        left: 20,
        position: "absolute",
        top: 20,
        zIndex: 2,
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
    errorBox: {
        alignSelf: "stretch",
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
        borderRadius: 8,
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
    eyebrow: {
        ...typography.label,
        color: "rgba(255,255,255,0.5)",
        marginTop: 18,
    },
    forgotButton: {
        alignSelf: "center",
        marginTop: 14,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    forgotText: {
        ...typography.body,
        fontSize: 13,
    },
    formContent: {
        alignSelf: "center",
        maxWidth: 460,
        paddingHorizontal: 8,
        width: "100%",
    },
    // Keep the form centered on tall screens while allowing it to scroll
    // above the keyboard on compact devices.
    formScrollContent: {
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: 24,
    },
    formWrap: {
        flex: 1,
        zIndex: 1,
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
        fontSize: 48,
        marginBottom: 24,
    },
    input: {
        color: colors.text,
        flex: 1,
        fontFamily: typography.bodyLarge.fontFamily,
        fontSize: 18,
        letterSpacing: 0,
        paddingVertical: 14,
    },
    inputArea: {
        marginTop: 22,
        position: "relative",
    },
    inputFrame: {
        backgroundColor: colors.input,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        overflow: "hidden",
    },
    inputRow: {
        alignItems: "center",
        flexDirection: "row",
        paddingHorizontal: 14,
    },
    layout: {
        backgroundColor: colors.bg,
    },
    logoBlock: {
        alignItems: "flex-start",
    },
    noticeBox: {
        alignSelf: "stretch",
        backgroundColor: colors.successBg,
        borderColor: colors.successBorder,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    noticeText: {
        ...typography.body,
        color: colors.successText,
        textAlign: "center",
    },
    passkeyBtn: {
        marginTop: 10,
        width: "100%",
    },
    passwordArea: {
        marginTop: 14,
        position: "relative",
    },
    passwordToggle: {
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        width: 44,
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
