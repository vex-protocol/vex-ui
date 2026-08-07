import type { AuthScreenProps } from "../navigation/types";

import React, { useCallback, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { Avatar } from "../components/Avatar";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { SectionDivider } from "../components/SectionDivider";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { haptic } from "../lib/haptics";
import {
    clearCredentials,
    type KnownAccount,
    listKnownAccounts,
} from "../lib/keychain";
import { colors, fontFamilies, typography, useAccentColors } from "../theme";

interface AccountRowProps {
    account: KnownAccount;
    busy: boolean;
    disabled: boolean;
    onLongPress: () => void;
    onPress: () => void;
}

type Props = AuthScreenProps<"AccountSelector">;

/**
 * Account picker: saved slots on this device. Choosing one opens credential
 * entry for that account. Long-press removes key material for that slot.
 */
export function AccountSelectorScreen({ navigation, route }: Props) {
    const [accounts, setAccounts] = useState<KnownAccount[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [errorText, setErrorText] = useState<null | string>(null);
    const routeError = route.params?.error ?? null;

    const refresh = useCallback(async () => {
        const list = await listKnownAccounts();
        setAccounts(list);
        setHydrated(true);
    }, []);

    useFocusEffect(
        useCallback(() => {
            setErrorText(routeError);
            void refresh();
        }, [refresh, routeError]),
    );

    const handleSelect = useCallback(
        (account: KnownAccount) => {
            haptic("confirm");
            setErrorText(null);
            navigation.navigate("HangTight", {
                force: true,
                fromAccountPicker: true,
                mode: "signin",
                username: account.username,
            });
        },
        [navigation],
    );

    const handleRemove = useCallback(
        (account: KnownAccount) => {
            haptic("destructive");
            Alert.alert(
                `Remove @${account.username}?`,
                "This deletes this account's device key from this phone. " +
                    "You'll need to approve a fresh sign-in from another " +
                    "signed-in device to use this account here again.",
                [
                    { style: "cancel", text: "Cancel" },
                    {
                        onPress: () => {
                            void (async () => {
                                await clearCredentials(account.username);
                                await refresh();
                            })();
                        },
                        style: "destructive",
                        text: "Remove",
                    },
                ],
            );
        },
        [refresh],
    );

    const handleAddAccount = useCallback(() => {
        haptic("tap");
        setErrorText(null);
        navigation.navigate("HangTight", {
            force: true,
            mode: "signin",
        });
    }, [navigation]);

    const handleCreateAccount = useCallback(() => {
        haptic("tap");
        setErrorText(null);
        navigation.navigate("HangTight", {
            force: true,
            mode: "signup",
        });
    }, [navigation]);

    if (!hydrated) {
        return (
            <ScreenLayout>
                <View style={styles.empty} />
            </ScreenLayout>
        );
    }

    if (accounts.length === 0) {
        return (
            <ScreenLayout glows>
                <ScrollView
                    contentContainerStyle={styles.zeroScroll}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.zeroHero}>
                        <VexLogo size={40} />
                        <Text style={styles.heading}>Welcome to Vex</Text>
                        <Text style={styles.subtitle}>
                            No accounts on this device yet.
                        </Text>
                    </View>
                    {errorText ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{errorText}</Text>
                        </View>
                    ) : null}
                    <VexButton
                        glow
                        icon="log-in-outline"
                        onPress={handleAddAccount}
                        style={styles.addButton}
                        title="Sign in"
                        variant="primary"
                    />
                    <VexButton
                        icon="person-add-outline"
                        onPress={handleCreateAccount}
                        style={styles.addButton}
                        title="Create account"
                        variant="outline"
                    />
                </ScrollView>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout glows>
            <View style={styles.header}>
                <Text style={styles.kicker}>SAVED ACCOUNTS</Text>
                <Text style={styles.heading}>Choose account</Text>
            </View>

            {errorText ? (
                <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorText}</Text>
                </View>
            ) : null}

            <ScrollView
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                style={styles.list}
            >
                {accounts.map((account) => (
                    <AccountRow
                        account={account}
                        busy={false}
                        disabled={false}
                        key={account.username}
                        onLongPress={() => {
                            handleRemove(account);
                        }}
                        onPress={() => {
                            handleSelect(account);
                        }}
                    />
                ))}
                <SectionDivider label="Or" />
                <VexButton
                    icon="add"
                    onPress={handleAddAccount}
                    style={styles.addButton}
                    title="Add another account"
                    variant="outline"
                />
                <VexButton
                    icon="person-add-outline"
                    onPress={handleCreateAccount}
                    style={styles.createButton}
                    title="Create account"
                    variant="outline"
                />
            </ScrollView>
        </ScreenLayout>
    );
}

function AccountRow({
    account,
    busy,
    disabled,
    onLongPress,
    onPress,
}: AccountRowProps) {
    const accent = useAccentColors();
    const userID = account.userID;
    return (
        <Pressable
            android_ripple={{ color: accent.accentSoft }}
            delayLongPress={400}
            disabled={disabled}
            onLongPress={onLongPress}
            onPress={onPress}
            style={({ pressed }) => [
                styles.rowPressable,
                pressed && styles.rowPressed,
                disabled && styles.rowDisabled,
            ]}
        >
            <CornerBracketBox
                color={busy ? colors.success : colors.border}
                size={8}
            >
                <View
                    style={[styles.accountCard, busy && styles.accountCardBusy]}
                >
                    {userID ? (
                        <Avatar
                            displayName={account.username}
                            ring={{
                                color: busy
                                    ? colors.success
                                    : accent.accentDark,
                                width: busy ? 2 : 1,
                            }}
                            size={42}
                            userID={userID}
                        />
                    ) : (
                        <View
                            style={[
                                styles.fallbackAvatar,
                                { backgroundColor: accent.accentSoft },
                            ]}
                        >
                            <Text style={styles.fallbackInitial}>
                                {account.username.charAt(0).toUpperCase()}
                            </Text>
                        </View>
                    )}
                    <View style={styles.rowText}>
                        <Text numberOfLines={1} style={styles.handle}>
                            @{account.username}
                        </Text>
                        <Text numberOfLines={1} style={styles.deviceLine}>
                            device {shortDeviceID(account.deviceID)}
                        </Text>
                    </View>
                    {busy ? (
                        <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>Opening</Text>
                        </View>
                    ) : (
                        <View style={styles.rowActions}>
                            <Pressable
                                accessibilityLabel={`Remove @${account.username} from this device`}
                                accessibilityRole="button"
                                hitSlop={8}
                                onPress={(event) => {
                                    event.stopPropagation();
                                    onLongPress();
                                }}
                                style={styles.removeButton}
                            >
                                <Ionicons
                                    color="rgba(255,255,255,0.48)"
                                    name="trash-outline"
                                    size={17}
                                />
                            </Pressable>
                            <Ionicons
                                color="rgba(255,255,255,0.48)"
                                name="chevron-forward"
                                size={18}
                            />
                        </View>
                    )}
                </View>
            </CornerBracketBox>
        </Pressable>
    );
}

function shortDeviceID(deviceID: string): string {
    if (deviceID.length <= 12) return deviceID;
    return `${deviceID.slice(0, 6)}…${deviceID.slice(-4)}`;
}

const styles = StyleSheet.create({
    accountCard: {
        alignItems: "center",
        backgroundColor: colors.surface,
        flexDirection: "row",
        gap: 12,
        padding: 16,
    },
    accountCardBusy: {
        backgroundColor: colors.successBg,
    },
    addButton: {
        width: "100%",
    },
    createButton: {
        marginTop: 10,
        width: "100%",
    },
    currentBadge: {
        backgroundColor: colors.successBg,
        borderColor: colors.successBorder,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    currentBadgeText: {
        ...typography.button,
        color: colors.successText,
        fontSize: 12,
    },
    deviceLine: {
        ...typography.body,
        color: colors.muted,
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        marginTop: 3,
    },
    empty: { flex: 1 },
    errorBox: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    fallbackAvatar: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.2)",
        borderRadius: 21,
        borderWidth: StyleSheet.hairlineWidth,
        height: 42,
        justifyContent: "center",
        width: 42,
    },
    fallbackInitial: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 18,
    },
    handle: {
        ...typography.button,
        color: colors.text,
        fontSize: 14,
    },
    header: {
        alignItems: "flex-start",
        gap: 6,
        marginBottom: 18,
        marginTop: 20,
    },
    heading: {
        ...typography.headingSmall,
        color: colors.text,
    },
    kicker: {
        ...typography.label,
        color: colors.muted,
    },
    list: {
        flex: 1,
    },
    listContent: {
        gap: 8,
        paddingBottom: 8,
    },
    removeButton: {
        alignItems: "center",
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    rowActions: {
        alignItems: "center",
        flexDirection: "row",
        gap: 2,
    },
    rowDisabled: {
        opacity: 0.38,
    },
    rowPressable: {},
    rowPressed: {
        opacity: 0.88,
        transform: [{ scale: 0.985 }],
    },
    rowText: {
        flex: 1,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        lineHeight: 20,
        textAlign: "center",
    },
    zeroHero: {
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
    },
    zeroScroll: {
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: 24,
    },
});
