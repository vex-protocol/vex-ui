import type { Passkey } from "@vex-chat/libvex";

import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { useFocusEffect } from "@react-navigation/native";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { PrivacyMeter } from "../components/PrivacyMeter";
import { VexButton } from "../components/VexButton";
import { VexField } from "../components/VexField";
import { haptic } from "../lib/haptics";
import {
    isPasskeySupported,
    PasskeyCancelledError,
    registerPasskey,
} from "../lib/passkey";
import { colors, typography } from "../theme";

interface AddState {
    error: null | string;
    name: string;
    submitting: boolean;
}

const DEFAULT_PASSKEY_NAME_HINT = "iPhone, Yubikey, etc.";

export function PasskeysScreen() {
    const [passkeys, setPasskeys] = useState<Passkey[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<null | string>(null);
    const [addState, setAddState] = useState<AddState>({
        error: null,
        name: "",
        submitting: false,
    });
    const supported = isPasskeySupported();

    const refresh = useCallback(async (silent = false) => {
        if (!silent) {
            setRefreshing(true);
        }
        setError(null);
        try {
            const list = await vexService.listPasskeys();
            // Most-recent first, with never-used keys sorted by creation
            // date (the natural fallback). Mirrors the device manager's
            // ordering so the user can scan the list the same way.
            const sorted = [...list].sort((a, b) => {
                const aMs = new Date(a.lastUsedAt ?? a.createdAt).getTime();
                const bMs = new Date(b.lastUsedAt ?? b.createdAt).getTime();
                return bMs - aMs;
            });
            setPasskeys(sorted);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Could not load passkeys.",
            );
        } finally {
            if (!silent) {
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useFocusEffect(
        useCallback(() => {
            void refresh(true);
        }, [refresh]),
    );

    async function handleAdd(): Promise<void> {
        const name = addState.name.trim();
        if (!supported) {
            setAddState((prev) => ({
                ...prev,
                error: "Passkeys aren't available on this device.",
            }));
            return;
        }
        if (name.length === 0) {
            setAddState((prev) => ({
                ...prev,
                error: "Give the passkey a name so you can recognize it later.",
            }));
            return;
        }
        setAddState((prev) => ({ ...prev, error: null, submitting: true }));
        try {
            haptic("confirm");
            const begin = await vexService.beginPasskeyRegistration(name);
            const response = await registerPasskey(begin.options);
            const finish = await vexService.finishPasskeyRegistration({
                name,
                requestID: begin.requestID,
                response,
            });
            if (!finish.ok) {
                setAddState((prev) => ({
                    ...prev,
                    error: finish.error ?? "Could not register the passkey.",
                    submitting: false,
                }));
                return;
            }
            setAddState({ error: null, name: "", submitting: false });
            await refresh(true);
        } catch (err: unknown) {
            if (err instanceof PasskeyCancelledError) {
                setAddState((prev) => ({ ...prev, submitting: false }));
                return;
            }
            setAddState((prev) => ({
                ...prev,
                error:
                    err instanceof Error
                        ? err.message
                        : "Could not register the passkey.",
                submitting: false,
            }));
        }
    }

    function handleDelete(passkey: Passkey): void {
        haptic("destructive");
        Alert.alert(
            `Remove "${passkey.name}"?`,
            "Passkeys are optional. You can add another one from this screen later.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void (async () => {
                            const result = await vexService.deletePasskey(
                                passkey.passkeyID,
                            );
                            if (!result.ok) {
                                Alert.alert(
                                    "Could not remove passkey",
                                    result.error ?? "Unknown error.",
                                );
                                return;
                            }
                            await refresh(true);
                        })();
                    },
                    style: "destructive",
                    text: "Remove",
                },
            ],
        );
    }

    return (
        <VexField glows style={styles.container}>
            <ChatHeader title="Passkeys" />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        onRefresh={() => {
                            void refresh();
                        }}
                        refreshing={refreshing}
                        tintColor={colors.textSecondary}
                    />
                }
            >
                <View style={styles.intro}>
                    <Text style={styles.kicker}>ACCOUNT RECOVERY</Text>
                    <Text style={styles.introText}>
                        {supported
                            ? "A passkey is an optional way to restore or sign in to your account. Vex never sees its secret."
                            : "This device doesn't support passkeys. iOS 16+ or Android 9+ with a screen lock is required."}
                    </Text>
                </View>

                <MenuSection title="Your Passkeys">
                    {passkeys.length === 0 && !refreshing ? (
                        <MenuRow
                            description="Add one below whenever you want an extra recovery method."
                            icon="key-outline"
                            label="No passkeys yet"
                            showChevron={false}
                        />
                    ) : null}
                    {passkeys.map((passkey) => {
                        const lastUsedLabel = passkey.lastUsedAt
                            ? `Last used ${new Date(
                                  passkey.lastUsedAt,
                              ).toLocaleString()}`
                            : `Added ${new Date(
                                  passkey.createdAt,
                              ).toLocaleDateString()}`;
                        return (
                            <MenuRow
                                accessory={
                                    <PrivacyMeter
                                        level={privacyLevelForPasskey(passkey)}
                                    />
                                }
                                description={lastUsedLabel}
                                icon="key-outline"
                                key={passkey.passkeyID}
                                label={passkey.name}
                                onPress={() => {
                                    handleDelete(passkey);
                                }}
                                showChevron={false}
                            />
                        );
                    })}
                </MenuSection>

                <View style={styles.formSection}>
                    <Text style={styles.sectionTitle}>Add a passkey</Text>
                    <View style={styles.formCard}>
                        <Text style={styles.formLabel}>Name</Text>
                        <TextInput
                            autoCapitalize="words"
                            autoCorrect={false}
                            editable={supported && !addState.submitting}
                            maxLength={64}
                            onChangeText={(text) => {
                                setAddState((prev) => ({
                                    ...prev,
                                    error: null,
                                    name: text,
                                }));
                            }}
                            placeholder={DEFAULT_PASSKEY_NAME_HINT}
                            placeholderTextColor="rgba(255,255,255,0.32)"
                            returnKeyType="done"
                            style={styles.formInput}
                            value={addState.name}
                        />
                        {addState.error ? (
                            <Text style={styles.formError}>
                                {addState.error}
                            </Text>
                        ) : null}
                        <VexButton
                            disabled={!supported || addState.submitting}
                            onPress={() => {
                                void handleAdd();
                            }}
                            style={styles.formButton}
                            title={
                                addState.submitting
                                    ? "Verifying..."
                                    : "Add passkey"
                            }
                            variant="primary"
                        />
                    </View>
                </View>

                <View style={styles.guidanceCard}>
                    <Text style={styles.guidanceTitle}>
                        Passkeys are supplementary
                    </Text>
                    <Text style={styles.guidanceText}>
                        You can use Vex without a passkey, then add or remove
                        passkeys here as your devices change.
                    </Text>
                </View>

                {error !== null ? (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}
            </ScrollView>
        </VexField>
    );
}

function privacyLevelForPasskey(passkey: Passkey): 1 | 2 | 3 | 4 {
    const name = passkey.name.toLowerCase();
    if (name.includes("yubi") || name.includes("security key")) {
        return 4;
    }
    return 3;
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
        paddingTop: 16,
    },
    errorCard: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    formButton: {
        marginTop: 4,
        width: "100%",
    },
    formCard: {
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.08)",
        borderRadius: 8,
        borderWidth: 1,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 14,
    },
    formError: {
        ...typography.body,
        color: colors.error,
        fontSize: 12,
    },
    formInput: {
        ...typography.body,
        backgroundColor: "rgba(0,0,0,0.32)",
        borderColor: "rgba(255,255,255,0.08)",
        borderRadius: 8,
        borderWidth: 1,
        color: colors.text,
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    formLabel: {
        ...typography.label,
        color: "rgba(255,255,255,0.5)",
        textTransform: "uppercase",
    },
    formSection: {
        gap: 8,
    },
    guidanceCard: {
        alignItems: "flex-start",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 6,
        padding: 14,
    },
    guidanceText: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
    },
    guidanceTitle: {
        ...typography.button,
        color: colors.text,
        fontSize: 14,
        fontWeight: "600",
    },
    intro: {
        gap: 6,
        marginBottom: -2,
    },
    introText: {
        ...typography.body,
        color: colors.muted,
    },
    kicker: {
        ...typography.label,
        color: colors.muted,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.muted,
        paddingHorizontal: 4,
        textTransform: "uppercase",
    },
});
