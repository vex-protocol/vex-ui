import type { AppScreenProps } from "../navigation/types";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { $user, vexService } from "@vex-chat/store";

import { useStore } from "@nanostores/react";
import { useFocusEffect } from "@react-navigation/native";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { colors, typography } from "../theme";

export function DeviceManagerScreen({
    navigation,
}: AppScreenProps<"DeviceManager">) {
    const user = useStore($user);
    const [deviceError, setDeviceError] = useState("");
    const [devices, setDevices] = useState<
        Awaited<ReturnType<typeof vexService.listMyDevices>>
    >([]);
    const [refreshing, setRefreshing] = useState(false);
    const [sessionInfo, setSessionInfo] =
        useState<Awaited<ReturnType<typeof vexService.getSessionInfo>>>(null);
    const inFlightRef = useRef(false);

    const refreshSessionAndDevices = useCallback(
        async (options?: { silent?: boolean }) => {
            if (inFlightRef.current) {
                return;
            }
            inFlightRef.current = true;
            const silent = options?.silent === true;
            try {
                if (!silent) {
                    setRefreshing(true);
                }
                setDeviceError("");
                const [session, myDevices] = await Promise.all([
                    vexService.getSessionInfo(),
                    vexService.listMyDevices(),
                ]);
                setSessionInfo(session);
                setDevices(myDevices);
            } catch (err: unknown) {
                setDeviceError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load devices.",
                );
            } finally {
                if (!silent) {
                    setRefreshing(false);
                }
                inFlightRef.current = false;
            }
        },
        [],
    );

    useEffect(() => {
        if (!user) {
            setSessionInfo(null);
            setDevices([]);
            return;
        }
        void refreshSessionAndDevices();
        // Depend on stable user identity only; full user object changes after
        // whoami would otherwise retrigger and cause refresh flicker.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshSessionAndDevices, user?.userID]);

    useEffect(() => {
        const unsubscribe = vexService.onDeviceRequestQueueChanged(() => {
            void refreshSessionAndDevices({ silent: true });
        });
        return () => {
            unsubscribe();
        };
    }, [refreshSessionAndDevices, user?.userID]);

    useFocusEffect(
        useCallback(() => {
            if (!user) {
                return;
            }
            void refreshSessionAndDevices({ silent: true });
        }, [refreshSessionAndDevices, user]),
    );

    const currentDeviceID = sessionInfo?.deviceID;

    return (
        <View style={styles.container}>
            <ChatHeader title="Device Manager" />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        onRefresh={() => {
                            void refreshSessionAndDevices();
                        }}
                        refreshing={refreshing}
                        tintColor={colors.textSecondary}
                    />
                }
            >
                <MenuSection
                    {...(devices.length <= 1
                        ? {
                              footer: "Your last remaining device cannot be removed.",
                          }
                        : {})}
                    title="Your Devices"
                >
                    {devices.map((device) => {
                        const isCurrent = device.deviceID === currentDeviceID;
                        const lastLoginLabel = new Date(
                            device.lastLogin,
                        ).toLocaleString();
                        return (
                            <MenuRow
                                accessory={
                                    isCurrent ? (
                                        <View style={styles.currentBadge}>
                                            <Text
                                                style={styles.currentBadgeText}
                                            >
                                                This device
                                            </Text>
                                        </View>
                                    ) : devices.length <= 1 ? (
                                        <View style={styles.currentBadge}>
                                            <Text
                                                style={styles.currentBadgeText}
                                            >
                                                Last device
                                            </Text>
                                        </View>
                                    ) : undefined
                                }
                                description={`Last login ${lastLoginLabel}`}
                                icon={
                                    isCurrent
                                        ? "phone-portrait"
                                        : "phone-portrait-outline"
                                }
                                key={device.deviceID}
                                label={device.name}
                                onPress={() => {
                                    navigation.navigate("DeviceDetails", {
                                        deviceID: device.deviceID,
                                        deviceName: device.name,
                                    });
                                }}
                                showChevron
                            />
                        );
                    })}
                    {devices.length === 0 && !refreshing ? (
                        <MenuRow
                            description="Pull to refresh"
                            icon="cloud-offline-outline"
                            label="No devices"
                        />
                    ) : null}
                </MenuSection>

                {deviceError !== "" ? (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorText}>{deviceError}</Text>
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
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
        paddingVertical: 12,
    },
    currentBadge: {
        backgroundColor: "rgba(74, 222, 128, 0.14)",
        borderColor: "rgba(74, 222, 128, 0.4)",
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    currentBadgeText: {
        ...typography.button,
        color: "#8DF5B0",
        fontSize: 12,
        fontWeight: "600",
    },
    errorCard: {
        backgroundColor: "rgba(229, 57, 53, 0.14)",
        borderColor: "rgba(229, 57, 53, 0.5)",
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
});
