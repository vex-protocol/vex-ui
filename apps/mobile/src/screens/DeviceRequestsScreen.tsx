import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    Vibration,
    View,
} from "react-native";

import { $user, vexService } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { matchingCodeForSignKey } from "../lib/deviceApprovalCode";
import { colors, typography } from "../theme";

export function DeviceRequestsScreen() {
    const user = useStore($user);
    const [deviceRequestBusy, setDeviceRequestBusy] = useState<
        Record<string, boolean>
    >({});
    const [deviceRequestError, setDeviceRequestError] = useState("");
    const [deviceRequests, setDeviceRequests] = useState<
        Awaited<ReturnType<typeof vexService.listPendingDeviceRequests>>
    >([]);
    const [loadingDeviceRequests, setLoadingDeviceRequests] = useState(false);
    const refreshInFlightRef = useRef(false);

    const refreshDeviceRequests = useCallback(
        async (options?: { silent?: boolean }): Promise<void> => {
            if (refreshInFlightRef.current) {
                return;
            }
            refreshInFlightRef.current = true;
            const silent = options?.silent === true;
            try {
                if (!user) {
                    setDeviceRequests([]);
                    return;
                }
                if (!silent) {
                    setLoadingDeviceRequests(true);
                }
                setDeviceRequestError("");
                const requests = await vexService.listPendingDeviceRequests();
                setDeviceRequests(
                    requests.filter((request) => request.status === "pending"),
                );
            } catch (err: unknown) {
                setDeviceRequestError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load device requests.",
                );
            } finally {
                if (!silent) {
                    setLoadingDeviceRequests(false);
                }
                refreshInFlightRef.current = false;
            }
        },
        [user],
    );

    useEffect(() => {
        void refreshDeviceRequests();
    }, [refreshDeviceRequests, user?.userID]);

    useEffect(() => {
        const unsubscribe = vexService.onDeviceRequestQueueChanged(() => {
            void refreshDeviceRequests({ silent: true });
        });
        return () => {
            unsubscribe();
        };
    }, [refreshDeviceRequests, user?.userID]);

    async function approveDeviceRequest(requestID: string): Promise<void> {
        Vibration.vibrate([0, 12, 40, 12]);
        setDeviceRequestBusy((prev) => ({ ...prev, [requestID]: true }));
        setDeviceRequestError("");
        try {
            const result = await vexService.approveDeviceRequest(requestID);
            if (!result.ok) {
                setDeviceRequestError(
                    result.error ?? "Failed to approve device request.",
                );
                return;
            }
            Vibration.vibrate(20);
            await refreshDeviceRequests();
        } finally {
            setDeviceRequestBusy((prev) => ({ ...prev, [requestID]: false }));
        }
    }

    async function rejectDeviceRequest(requestID: string): Promise<void> {
        setDeviceRequestBusy((prev) => ({ ...prev, [requestID]: true }));
        setDeviceRequestError("");
        try {
            const result = await vexService.rejectDeviceRequest(requestID);
            if (!result.ok) {
                setDeviceRequestError(
                    result.error ?? "Failed to reject device request.",
                );
                return;
            }
            await refreshDeviceRequests();
        } finally {
            setDeviceRequestBusy((prev) => ({ ...prev, [requestID]: false }));
        }
    }

    return (
        <View style={styles.container}>
            <ChatHeader title="Device Requests" />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        onRefresh={() => {
                            void refreshDeviceRequests();
                        }}
                        refreshing={loadingDeviceRequests}
                        tintColor={colors.textSecondary}
                    />
                }
            >
                {deviceRequests.length === 0 && !loadingDeviceRequests ? (
                    <MenuSection title="Inbox">
                        <MenuRow
                            description="Pull to refresh"
                            icon="checkmark-done-outline"
                            label="No pending requests"
                        />
                    </MenuSection>
                ) : null}

                {deviceRequestError !== "" ? (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorText}>
                            {deviceRequestError}
                        </Text>
                    </View>
                ) : null}

                {deviceRequests.length > 0 ? (
                    <MenuSection title="Pending requests">
                        {deviceRequests.map((request) => {
                            const busy =
                                deviceRequestBusy[request.requestID] === true;
                            const codeChars = matchingCodeForSignKey(
                                request.signKey ?? null,
                            );
                            return (
                                <View
                                    key={request.requestID}
                                    style={styles.requestCard}
                                >
                                    <View style={styles.requestHeader}>
                                        <Text style={styles.label}>
                                            {request.deviceName}
                                        </Text>
                                        <Text style={styles.desc}>
                                            Request{" "}
                                            {request.requestID.slice(0, 8)}…
                                        </Text>
                                    </View>
                                    <Text style={styles.matchHint}>
                                        Confirm this code matches what you see
                                        on the new device:
                                    </Text>
                                    <View style={styles.codeRow}>
                                        {codeChars.map((char, i) => (
                                            <CornerBracketBox
                                                color={colors.error}
                                                key={i}
                                                size={5}
                                                thickness={1.5}
                                            >
                                                <View style={styles.cell}>
                                                    <Text
                                                        style={styles.cellText}
                                                    >
                                                        {char}
                                                    </Text>
                                                </View>
                                            </CornerBracketBox>
                                        ))}
                                    </View>
                                    <View style={styles.inlineActions}>
                                        <TouchableOpacity
                                            disabled={busy}
                                            onPress={() => {
                                                void rejectDeviceRequest(
                                                    request.requestID,
                                                );
                                            }}
                                            style={styles.rejectBtn}
                                        >
                                            <Text style={styles.rejectBtnText}>
                                                Reject
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            disabled={busy}
                                            onPress={() => {
                                                void approveDeviceRequest(
                                                    request.requestID,
                                                );
                                            }}
                                            style={styles.approveBtn}
                                        >
                                            <Text style={styles.approveBtnText}>
                                                {busy ? "..." : "Approve"}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            );
                        })}
                    </MenuSection>
                ) : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    approveBtn: {
        alignItems: "center",
        borderColor: "rgba(74, 222, 128, 0.45)",
        borderRadius: 10,
        borderWidth: 1,
        minWidth: 74,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    approveBtnText: {
        ...typography.button,
        color: "#4ADE80",
        fontWeight: "600",
    },
    cell: {
        alignItems: "center",
        backgroundColor: "rgba(229, 57, 53, 0.08)",
        borderColor: "rgba(229, 57, 53, 0.4)",
        borderWidth: 1,
        height: 52,
        justifyContent: "center",
        width: 44,
    },
    cellText: {
        ...typography.button,
        color: colors.text,
        fontSize: 22,
        letterSpacing: 1,
    },
    codeRow: {
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        paddingVertical: 6,
    },
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
    desc: {
        ...typography.body,
        color: "rgba(255,255,255,0.52)",
        fontSize: 12,
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
    inlineActions: {
        flexDirection: "row",
        gap: 8,
        justifyContent: "flex-end",
    },
    label: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 14,
        fontWeight: "600",
    },
    matchHint: {
        ...typography.body,
        color: "rgba(255,255,255,0.62)",
        fontSize: 12,
    },
    rejectBtn: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.18)",
        borderRadius: 10,
        borderWidth: 1,
        minWidth: 70,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    rejectBtnText: {
        ...typography.button,
        color: colors.textSecondary,
        fontWeight: "600",
    },
    requestCard: {
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.08)",
        borderRadius: 10,
        borderWidth: 1,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    requestHeader: {
        gap: 2,
    },
});
