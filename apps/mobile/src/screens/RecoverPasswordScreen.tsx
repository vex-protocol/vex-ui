import type { AuthScreenProps } from "../navigation/types";

import React, { useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";

import { BackButton } from "../components/BackButton";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { getServerOptions } from "../lib/config";
import { keychainKeyStore } from "../lib/keychain";
import { mobileConfig } from "../lib/platform";
import { colors, typography, useAccentColors } from "../theme";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,19}$/;

export function RecoverPasswordScreen({
    navigation,
    route,
}: AuthScreenProps<"RecoverPassword">) {
    const accent = useAccentColors();
    const [username, setUsername] = useState(
        route.params?.username?.toLowerCase() ?? "",
    );
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function handleReset(): Promise<void> {
        if (busy) return;
        const normalizedUsername = username.trim().toLowerCase();
        if (!HANDLE_PATTERN.test(normalizedUsername)) {
            setError("Enter a valid username.");
            return;
        }
        if (newPassword.length < 15) {
            setError("Use at least 15 characters for the new password.");
            return;
        }
        if (newPassword.length > 1024) {
            setError("The new password is too long.");
            return;
        }
        if (newPassword !== confirmation) {
            setError("Passwords do not match.");
            return;
        }

        setBusy(true);
        setError("");
        try {
            const authentication =
                await vexService.authenticateAccountWithPasskey(
                    normalizedUsername,
                    mobileConfig(),
                    getServerOptions(),
                    keychainKeyStore,
                );
            if (!authentication.ok) {
                setError(
                    authentication.error ??
                        "Could not verify an account passkey.",
                );
                return;
            }

            const reset =
                await vexService.resetPasswordWithPasskey(newPassword);
            if (!reset.ok) {
                setError(reset.error ?? "Could not reset the password.");
                return;
            }

            await vexService.logout();
            navigation.replace("HangTight", {
                force: true,
                mode: "signin",
                notice: "Password updated. Sign in with your new password.",
                username: normalizedUsername,
            });
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not reset the password.",
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScreenLayout padded={false} style={styles.layout}>
            <View style={styles.backButton}>
                <BackButton />
            </View>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.keyboardView}
            >
                <ScrollView
                    bounces={false}
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.form}>
                        <Text style={styles.eyebrow}>ACCOUNT RECOVERY</Text>
                        <Text style={styles.heading}>Reset password</Text>
                        <Text style={styles.subheading}>
                            Verify with a passkey already added to this account.
                        </Text>

                        <Field label="Username">
                            <TextInput
                                autoCapitalize="none"
                                autoComplete="username"
                                autoCorrect={false}
                                editable={!busy}
                                maxLength={19}
                                onChangeText={(value) => {
                                    setUsername(
                                        value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9_]/g, ""),
                                    );
                                    setError("");
                                }}
                                placeholder="username"
                                placeholderTextColor={colors.mutedDark}
                                returnKeyType="next"
                                selectionColor={accent.accent}
                                style={styles.input}
                                value={username}
                            />
                        </Field>

                        <Field label="New password">
                            <View style={styles.passwordRow}>
                                <TextInput
                                    autoCapitalize="none"
                                    autoComplete="new-password"
                                    autoCorrect={false}
                                    editable={!busy}
                                    maxLength={1024}
                                    onChangeText={(value) => {
                                        setNewPassword(value);
                                        setError("");
                                    }}
                                    placeholder="15 characters minimum"
                                    placeholderTextColor={colors.mutedDark}
                                    secureTextEntry={!showPassword}
                                    selectionColor={accent.accent}
                                    style={styles.input}
                                    textContentType="newPassword"
                                    value={newPassword}
                                />
                                <PasswordToggle
                                    onPress={() => {
                                        setShowPassword((shown) => !shown);
                                    }}
                                    shown={showPassword}
                                />
                            </View>
                        </Field>

                        <Field label="Confirm new password">
                            <TextInput
                                autoCapitalize="none"
                                autoComplete="new-password"
                                autoCorrect={false}
                                editable={!busy}
                                maxLength={1024}
                                onChangeText={(value) => {
                                    setConfirmation(value);
                                    setError("");
                                }}
                                onSubmitEditing={() => {
                                    void handleReset();
                                }}
                                placeholder="enter it again"
                                placeholderTextColor={colors.mutedDark}
                                returnKeyType="go"
                                secureTextEntry={!showPassword}
                                selectionColor={accent.accent}
                                style={styles.input}
                                textContentType="newPassword"
                                value={confirmation}
                            />
                        </Field>

                        {error ? (
                            <View style={styles.errorBox}>
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <VexButton
                            disabled={busy}
                            glow
                            icon="key-outline"
                            loading={busy}
                            onPress={() => {
                                void handleReset();
                            }}
                            title={busy ? "Verifying..." : "Verify and reset"}
                            variant="primary"
                        />
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </ScreenLayout>
    );
}

function Field({
    children,
    label,
}: {
    children: React.ReactNode;
    label: string;
}) {
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <CornerBracketBox color={colors.border} size={9} thickness={1.5}>
                <View style={styles.inputFrame}>{children}</View>
            </CornerBracketBox>
        </View>
    );
}

function PasswordToggle({
    onPress,
    shown,
}: {
    onPress: () => void;
    shown: boolean;
}) {
    return (
        <Pressable
            accessibilityLabel={shown ? "Hide password" : "Show password"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onPress}
            style={styles.passwordToggle}
        >
            <Ionicons
                color={colors.muted}
                name={shown ? "eye-off-outline" : "eye-outline"}
                size={20}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backButton: {
        left: 20,
        position: "absolute",
        top: 20,
        zIndex: 2,
    },
    content: {
        flexGrow: 1,
        justifyContent: "center",
        paddingBottom: 32,
        paddingHorizontal: 24,
        paddingTop: 72,
    },
    errorBox: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
        borderWidth: 1,
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
        color: colors.muted,
    },
    field: {
        gap: 7,
    },
    form: {
        alignSelf: "center",
        gap: 16,
        maxWidth: 460,
        width: "100%",
    },
    heading: {
        ...typography.headingSmall,
        color: colors.text,
    },
    input: {
        ...typography.bodyLarge,
        color: colors.text,
        flex: 1,
        letterSpacing: 0,
        paddingHorizontal: 14,
        paddingVertical: 13,
    },
    inputFrame: {
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        flexDirection: "row",
        minHeight: 52,
    },
    keyboardView: {
        flex: 1,
    },
    label: {
        ...typography.label,
        color: colors.textSecondary,
        letterSpacing: 0,
    },
    layout: {
        backgroundColor: colors.bg,
    },
    passwordRow: {
        flex: 1,
        flexDirection: "row",
    },
    passwordToggle: {
        alignItems: "center",
        height: 50,
        justifyContent: "center",
        width: 46,
    },
    subheading: {
        ...typography.body,
        color: colors.muted,
        marginBottom: 4,
    },
});
