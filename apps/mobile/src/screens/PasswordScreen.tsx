import React, { useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { ChatHeader } from "../components/ChatHeader";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { VexButton } from "../components/VexButton";
import { VexField } from "../components/VexField";
import { colors, typography } from "../theme";

export function PasswordScreen() {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [showPasswords, setShowPasswords] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    async function handleSubmit(): Promise<void> {
        if (busy) return;
        setError("");
        setNotice("");
        if (!currentPassword) {
            setError("Enter your current password.");
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
            setError("New passwords do not match.");
            return;
        }

        setBusy(true);
        try {
            const result = await vexService.changePassword(
                currentPassword,
                newPassword,
            );
            if (!result.ok) {
                setError(result.error ?? "Could not change password.");
                return;
            }
            setCurrentPassword("");
            setNewPassword("");
            setConfirmation("");
            setNotice("Password updated.");
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not change password.",
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <VexField style={styles.container}>
            <ChatHeader title="Password" />
            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.intro}>
                    <Text style={styles.kicker}>ACCOUNT SECURITY</Text>
                    <Text style={styles.introText}>
                        Use 15 or more characters. Symbols and capitalization
                        are optional.
                    </Text>
                </View>

                <PasswordField
                    autoComplete="current-password"
                    label="Current password"
                    onChangeText={(value) => {
                        setCurrentPassword(value);
                        setError("");
                        setNotice("");
                    }}
                    secure={!showPasswords}
                    value={currentPassword}
                />
                <PasswordField
                    autoComplete="new-password"
                    label="New password"
                    onChangeText={(value) => {
                        setNewPassword(value);
                        setError("");
                        setNotice("");
                    }}
                    placeholder="15 characters minimum"
                    secure={!showPasswords}
                    value={newPassword}
                />
                <PasswordField
                    autoComplete="new-password"
                    label="Confirm new password"
                    onChangeText={(value) => {
                        setConfirmation(value);
                        setError("");
                        setNotice("");
                    }}
                    onSubmit={() => {
                        void handleSubmit();
                    }}
                    secure={!showPasswords}
                    value={confirmation}
                />

                <View style={styles.toggleRow}>
                    <View style={styles.toggleCopy}>
                        <Text style={styles.toggleLabel}>Show passwords</Text>
                        <Text style={styles.toggleDescription}>
                            Reveal all three fields
                        </Text>
                    </View>
                    <Switch
                        onValueChange={setShowPasswords}
                        thumbColor={colors.text}
                        trackColor={{
                            false: colors.border,
                            true: colors.accentDark,
                        }}
                        value={showPasswords}
                    />
                </View>

                {error ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}
                {notice ? (
                    <View style={styles.noticeBox}>
                        <Text style={styles.noticeText}>{notice}</Text>
                    </View>
                ) : null}

                <VexButton
                    disabled={busy}
                    loading={busy}
                    onPress={() => {
                        void handleSubmit();
                    }}
                    title={busy ? "Updating..." : "Update password"}
                    variant="primary"
                />
            </ScrollView>
        </VexField>
    );
}

function PasswordField({
    autoComplete,
    label,
    onChangeText,
    onSubmit,
    placeholder,
    secure,
    value,
}: {
    autoComplete: "current-password" | "new-password";
    label: string;
    onChangeText: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
    secure: boolean;
    value: string;
}) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <CornerBracketBox color={colors.border} size={8} thickness={1.5}>
                <TextInput
                    autoCapitalize="none"
                    autoComplete={autoComplete}
                    autoCorrect={false}
                    maxLength={1024}
                    onChangeText={onChangeText}
                    onSubmitEditing={onSubmit}
                    placeholder={placeholder}
                    placeholderTextColor={colors.mutedDark}
                    returnKeyType={onSubmit ? "go" : "next"}
                    secureTextEntry={secure}
                    selectionColor={colors.accent}
                    style={styles.input}
                    textContentType={
                        autoComplete === "current-password"
                            ? "password"
                            : "newPassword"
                    }
                    value={value}
                />
            </CornerBracketBox>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        gap: 16,
        paddingBottom: 32,
        paddingHorizontal: 16,
        paddingTop: 18,
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
    },
    field: {
        gap: 7,
    },
    fieldLabel: {
        ...typography.label,
        color: colors.textSecondary,
        letterSpacing: 0,
    },
    input: {
        ...typography.bodyLarge,
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        color: colors.text,
        letterSpacing: 0,
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    intro: {
        gap: 6,
        marginBottom: 2,
    },
    introText: {
        ...typography.body,
        color: colors.muted,
    },
    kicker: {
        ...typography.label,
        color: colors.accentMuted,
        letterSpacing: 0,
    },
    noticeBox: {
        backgroundColor: colors.successBg,
        borderColor: colors.successBorder,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    noticeText: {
        ...typography.body,
        color: colors.successText,
    },
    toggleCopy: {
        flex: 1,
        gap: 2,
    },
    toggleDescription: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
    },
    toggleLabel: {
        ...typography.body,
        color: colors.textSecondary,
        fontWeight: "600",
    },
    toggleRow: {
        alignItems: "center",
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 12,
    },
});
