import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { $authStatus, $user, vexService } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { getServerUrl } from "../lib/config";
import { colors, typography } from "../theme";

export function SessionDetailsScreen() {
    const authStatus = useStore($authStatus);
    const user = useStore($user);
    const [sessionInfo, setSessionInfo] =
        useState<Awaited<ReturnType<typeof vexService.getSessionInfo>>>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const refreshInFlightRef = useRef(false);

    const refreshSession = useCallback(
        async (options?: { silent?: boolean }): Promise<void> => {
            if (refreshInFlightRef.current) {
                return;
            }
            refreshInFlightRef.current = true;
            const silent = options?.silent === true;
            try {
                if (!silent) {
                    setRefreshing(true);
                }
                setError("");
                const session = await vexService.getSessionInfo();
                setSessionInfo(session);
            } catch (err: unknown) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load session details.",
                );
            } finally {
                if (!silent) {
                    setRefreshing(false);
                }
                refreshInFlightRef.current = false;
            }
        },
        [],
    );

    useEffect(() => {
        if (!user) {
            setSessionInfo(null);
            return;
        }
        void refreshSession();
    }, [refreshSession, user]);

    const expiresLabel = sessionInfo?.tokenExpiresAt
        ? new Date(sessionInfo.tokenExpiresAt).toLocaleString()
        : "Unknown";
    const remainingLabel =
        typeof sessionInfo?.tokenRemainingHours === "number"
            ? `${sessionInfo.tokenRemainingHours}h`
            : "Unknown";

    return (
        <View style={styles.container}>
            <ChatHeader title="Session" />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        onRefresh={() => {
                            void refreshSession();
                        }}
                        refreshing={refreshing}
                        tintColor={colors.textSecondary}
                    />
                }
            >
                <MenuSection title="Connection">
                    <MenuRow
                        icon="shield-checkmark-outline"
                        label="Auth status"
                        value={authStatus}
                    />
                    <MenuRow
                        icon="server-outline"
                        label="Server"
                        value={getServerUrl()}
                    />
                </MenuSection>

                <MenuSection title="Token">
                    <MenuRow
                        icon="phone-portrait-outline"
                        label="Current device"
                        monoBlock={sessionInfo?.deviceID ?? "—"}
                    />
                    <MenuRow
                        icon="time-outline"
                        label="Session expires"
                        value={expiresLabel}
                    />
                    <MenuRow
                        icon="hourglass-outline"
                        label="Time remaining"
                        value={remainingLabel}
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
