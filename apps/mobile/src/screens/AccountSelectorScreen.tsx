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

import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { Avatar } from "../components/Avatar";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { SectionDivider } from "../components/SectionDivider";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { getServerOptions } from "../lib/config";
import { haptic } from "../lib/haptics";
import {
    clearCredentials,
    keychainKeyStore,
    type KnownAccount,
    listKnownAccounts,
} from "../lib/keychain";
import { mobileConfig } from "../lib/platform";
import { colors, fontFamilies, typography } from "../theme";

interface AccountRowProps {
    account: KnownAccount;
    busy: boolean;
    disabled: boolean;
    onLongPress: () => void;
    onPress: () => void;
}

type Props = AuthScreenProps<"AccountSelector">;

/**
 * Account picker: saved slots on this device. Choosing one starts account auth;
 * local dev can use the saved Vex device key directly, while normal builds use
 * passkey auth before provisioning. Long-press removes key material for that slot.
 */
export function AccountSelectorScreen({ navigation, route }: Props) {
    const [accounts, setAccounts] = useState<KnownAccount[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [signingInUsername, setSigningInUsername] = useState<null | string>(
        null,
    );
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
        async (account: KnownAccount) => {
            if (signingInUsername !== null) {
                return;
            }
            haptic("confirm");
            setErrorText(null);
            setSigningInUsername(account.username);
            try {
                const result = await vexService.authenticateAccountWithPasskey(
                    account.username,
                    mobileConfig(),
                    getServerOptions(),
                    keychainKeyStore,
                );
                if (!result.ok || !result.username) {
                    setErrorText(
                        result.userCancelled
                            ? "Passkey sign-in was cancelled."
                            : (result.error ??
                                  "Could not sign in with passkey."),
                    );
                    await refresh();
                    return;
                }
                if (result.localDeviceAuthenticated) {
                    return;
                }
                navigation.replace("ProvisionDevice", {
                    hasLocalDevice: result.hasLocalDevice === true,
                    ...(result.userID !== undefined
                        ? { userID: result.userID }
                        : {}),
                    username: result.username,
                });
            } catch (err: unknown) {
                setErrorText(
                    err instanceof Error
                        ? err.message
                        : "Could not activate this account.",
                );
                await refresh();
            } finally {
                setSigningInUsername(null);
            }
        },
        [navigation, refresh, signingInUsername],
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
        navigation.navigate("HangTight", { force: true });
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
                        disabled={signingInUsername !== null}
                        glow
                        icon="log-in-outline"
                        onPress={handleAddAccount}
                        style={styles.addButton}
                        title="Get started"
                        variant="primary"
                    />
                </ScrollView>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout glows>
            <View style={styles.header}>
                <Text style={styles.kicker}>SIGNED IN</Text>
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
                        busy={signingInUsername === account.username}
                        disabled={
                            signingInUsername !== null &&
                            signingInUsername !== account.username
                        }
                        key={account.username}
                        onLongPress={() => {
                            handleRemove(account);
                        }}
                        onPress={() => {
                            void handleSelect(account);
                        }}
                    />
                ))}
                <SectionDivider label="Or" />
                <VexButton
                    disabled={signingInUsername !== null}
                    icon="add"
                    onPress={handleAddAccount}
                    style={styles.addButton}
                    title="Add another account"
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
    const userID = account.userID;
    return (
        <Pressable
            android_ripple={{ color: "rgba(231, 0, 0, 0.12)" }}
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
                                    : colors.accentDark,
                                width: busy ? 2 : 1,
                            }}
                            size={42}
                            userID={userID}
                        />
                    ) : (
                        <View style={styles.fallbackAvatar}>
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
                            {userID
                                ? shortDeviceID(userID)
                                : `device ${shortDeviceID(account.deviceID)}`}
                        </Text>
                    </View>
                    {busy ? (
                        <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>Opening</Text>
                        </View>
                    ) : (
                        <Ionicons
                            color="rgba(255,255,255,0.48)"
                            name="chevron-forward"
                            size={18}
                        />
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
        color: "rgba(255,255,255,0.55)",
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        marginTop: 3,
    },
    empty: { flex: 1 },
    errorBox: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
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
        backgroundColor: "rgba(231, 0, 0, 0.22)",
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
        color: colors.accent,
    },
    list: {
        flex: 1,
    },
    listContent: {
        gap: 8,
        paddingBottom: 8,
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
        color: "rgba(255,255,255,0.52)",
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
