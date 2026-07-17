import type { AppScreenProps } from "../navigation/types";

import React, { useCallback, useEffect, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { colors, typography } from "../theme";

type DeviceRecord = Awaited<
    ReturnType<typeof vexService.listMyDevices>
>[number];

export function DeviceDetailsScreen({
    navigation,
    route,
}: AppScreenProps<"DeviceDetails">) {
    const [device, setDevice] = useState<DeviceRecord | null>(null);
    const [currentDeviceID, setCurrentDeviceID] = useState<null | string>(null);
    const [deviceCount, setDeviceCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [session, devices] = await Promise.all([
                vexService.getSessionInfo(),
                vexService.listMyDevices(),
            ]);
            setCurrentDeviceID(session?.deviceID ?? null);
            setDeviceCount(devices.length);
            const match =
                devices.find(
                    (entry) => entry.deviceID === route.params.deviceID,
                ) ?? null;
            setDevice(match);
            if (!match) {
                setError("Device no longer exists.");
            }
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load device details.",
            );
        } finally {
            setLoading(false);
        }
    }, [route.params.deviceID]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const isCurrent = device?.deviceID === currentDeviceID;
    const canRemove = Boolean(device) && !isCurrent && deviceCount > 1;
    const lastLoginLabel = device?.lastLogin
        ? new Date(device.lastLogin).toLocaleString()
        : "Unknown";
    const deviceIDLabel = device?.deviceID ?? route.params.deviceID;
    const removeHelper = isCurrent
        ? "Cannot remove the device currently in use"
        : !isCurrent && deviceCount <= 1
          ? "Cannot remove your last remaining device"
          : "Sign this device out everywhere";

    async function handleRemove(): Promise<void> {
        if (!device || !canRemove || busy) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            const result = await vexService.removeDevice(device.deviceID);
            if (!result.ok) {
                setError(result.error ?? "Failed to remove device.");
                return;
            }
            navigation.goBack();
        } finally {
            setBusy(false);
        }
    }

    const title = device?.name ?? route.params.deviceName ?? "Device details";

    return (
        <View style={styles.container}>
            <ChatHeader title={title} />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        onRefresh={() => {
                            void refresh();
                        }}
                        refreshing={loading}
                        tintColor={colors.textSecondary}
                    />
                }
            >
                <MenuSection title="Details">
                    <MenuRow
                        icon="hardware-chip-outline"
                        label="Name"
                        value={
                            device?.name ?? route.params.deviceName ?? "Unknown"
                        }
                    />
                    <MenuRow
                        icon="finger-print-outline"
                        label="Device ID"
                        monoBlock={deviceIDLabel}
                    />
                    <MenuRow
                        icon="time-outline"
                        label="Last login"
                        value={lastLoginLabel}
                    />
                    <MenuRow
                        icon={
                            isCurrent
                                ? "phone-portrait"
                                : "phone-portrait-outline"
                        }
                        label="Current device"
                        value={isCurrent ? "Yes" : "No"}
                    />
                </MenuSection>

                <MenuSection title="Actions">
                    <MenuRow
                        description={removeHelper}
                        disabled={!canRemove || busy || loading}
                        icon="trash-outline"
                        label={busy ? "Removing..." : "Remove device"}
                        onPress={() => {
                            void handleRemove();
                        }}
                        tone="danger"
                    />
                </MenuSection>

                {error !== "" ? (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorText}>{error}</Text>
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
});
