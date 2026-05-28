import type { AuthScreenProps } from "../navigation/types";

import React, { useCallback, useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    type ViewStyle,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import { BlurView } from "expo-blur";

import { Avatar } from "../components/Avatar";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { haptic } from "../lib/haptics";
import {
    clearCredentials,
    type KnownAccount,
    listKnownAccounts,
    setActiveUsername,
} from "../lib/keychain";
import { colors, typography } from "../theme";

interface AccountRowProps {
    account: KnownAccount;
    busy: boolean;
    disabled: boolean;
    onLongPress: () => void;
    onPress: () => void;
}

type Props = AuthScreenProps<"AccountSelector">;

/**
 * Account picker: saved slots on this device. Choosing one routes through
 * {@link HangTightScreen} (same boot path as cold start) so the “Hang tight”
 * experience is consistent. Long-press removes key material for that slot.
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
                await setActiveUsername(account.username);
                // Same bootstrap path as startup: HangTight runs retention
                // hydrate + autoLogin (and shows the spinner UI).
                navigation.replace("HangTight", { fromAccountPicker: true });
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
            <ScreenLayout style={styles.layout}>
                <ScrollView
                    contentContainerStyle={styles.zeroScroll}
                    showsVerticalScrollIndicator={false}
                >
                    <GlassSurface style={styles.heroGlass}>
                        <View style={styles.heroInner}>
                            <VexLogo size={40} />
                            <Text style={styles.heading}>Welcome to Vex</Text>
                            <Text style={styles.subtitle}>
                                No accounts on this device yet.
                            </Text>
                        </View>
                    </GlassSurface>
                    {errorText ? (
                        <View style={styles.errorGlass}>
                            <Text style={styles.errorText}>{errorText}</Text>
                        </View>
                    ) : null}
                    <VexButton
                        disabled={signingInUsername !== null}
                        glow
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
        <ScreenLayout style={styles.layout}>
            <GlassSurface style={styles.headerGlass}>
                <View style={styles.headerInner}>
                    <VexLogo size={30} />
                    <Text style={styles.heading}>Choose account</Text>
                    <Text style={styles.subtitle}>
                        Tap to sign in · Long-press to remove from device
                    </Text>
                </View>
            </GlassSurface>

            {errorText ? (
                <View style={styles.errorGlass}>
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
            </ScrollView>

            <GlassSurface style={styles.footerGlass}>
                <View style={styles.footerInner}>
                    <VexButton
                        disabled={signingInUsername !== null}
                        onPress={handleAddAccount}
                        style={styles.addButton}
                        title="Add another account"
                        variant="outline"
                    />
                </View>
            </GlassSurface>
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
            <View style={styles.glassOuter}>
                <BlurView
                    intensity={Platform.OS === "ios" ? 32 : 48}
                    style={StyleSheet.absoluteFill}
                    tint={
                        busy
                            ? "prominent"
                            : Platform.OS === "ios"
                              ? "systemThinMaterialDark"
                              : "dark"
                    }
                />
                <View
                    style={[
                        styles.rowInner,
                        busy && { borderColor: "rgba(231, 0, 0, 0.45)" },
                    ]}
                >
                    {userID ? (
                        <Avatar
                            displayName={account.username}
                            ring={{
                                color: busy ? colors.accent : colors.accentDark,
                                width: busy ? 2 : 1,
                            }}
                            size={56}
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
                            {busy
                                ? "Opening…"
                                : `device · ${shortDeviceID(account.deviceID)}`}
                        </Text>
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

function GlassSurface({
    children,
    style,
}: {
    children: React.ReactNode;
    style?: ViewStyle;
}): React.ReactElement {
    return (
        <View style={[styles.glassOuter, style]}>
            <BlurView
                intensity={Platform.OS === "ios" ? 36 : 52}
                style={StyleSheet.absoluteFill}
                tint={Platform.OS === "ios" ? "systemThinMaterialDark" : "dark"}
            />
            <View style={styles.glassInner}>{children}</View>
        </View>
    );
}

function shortDeviceID(deviceID: string): string {
    if (deviceID.length <= 12) return deviceID;
    return `${deviceID.slice(0, 6)}…${deviceID.slice(-4)}`;
}

const styles = StyleSheet.create({
    addButton: {
        width: "100%",
    },
    deviceLine: {
        ...typography.body,
        color: "rgba(255,255,255,0.55)",
        fontSize: 12,
        marginTop: 3,
    },
    empty: { flex: 1 },
    errorGlass: {
        backgroundColor: "rgba(229, 57, 53, 0.18)",
        borderColor: "rgba(229, 57, 53, 0.55)",
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
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
        borderRadius: 28,
        borderWidth: StyleSheet.hairlineWidth,
        height: 56,
        justifyContent: "center",
        width: 56,
    },
    fallbackInitial: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 22,
    },
    footerGlass: {
        marginTop: 4,
    },
    footerInner: {
        gap: 10,
        paddingHorizontal: 4,
        paddingVertical: 12,
    },
    glassInner: {
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
    glassOuter: {
        borderColor: "rgba(255,255,255,0.12)",
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
        position: "relative",
    },
    handle: {
        ...typography.button,
        color: colors.text,
        fontSize: 17,
        letterSpacing: 0.2,
    },
    headerGlass: {
        marginBottom: 8,
    },
    headerInner: {
        alignItems: "center",
        gap: 8,
        paddingBottom: 4,
        paddingTop: 8,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
        fontSize: 22,
        textAlign: "center",
    },
    heroGlass: {
        marginBottom: 20,
        width: "100%",
    },
    heroInner: {
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
    },
    layout: {
        backgroundColor: colors.bg,
    },
    list: {
        flex: 1,
    },
    listContent: {
        gap: 14,
        paddingBottom: 8,
        paddingTop: 8,
    },
    rowDisabled: {
        opacity: 0.38,
    },
    rowInner: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.06)",
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 16,
        paddingHorizontal: 18,
        paddingVertical: 16,
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
    zeroScroll: {
        flexGrow: 1,
        justifyContent: "center",
        paddingVertical: 24,
    },
});
