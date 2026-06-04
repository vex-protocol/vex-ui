import type { AppScreenProps } from "../navigation/types";

import React, { useMemo, useState } from "react";
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {
    $channels,
    $permissions,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { colors, typography } from "../theme";

export function ServerSettingsScreen({
    navigation,
    route,
}: AppScreenProps<"ServerSettings">) {
    const { serverID } = route.params;
    const channelsByServer = useStore($channels);
    const permissions = useStore($permissions);
    const servers = useStore($servers);
    const user = useStore($user);
    const [channelName, setChannelName] = useState("");
    const [creatingChannel, setCreatingChannel] = useState(false);
    const [createChannelError, setCreateChannelError] = useState("");
    const [deletingServer, setDeletingServer] = useState(false);
    const [leavingServer, setLeavingServer] = useState(false);
    const serverName =
        servers[serverID]?.name ?? route.params.serverName ?? "Server";
    const channels = channelsByServer[serverID] ?? [];
    const membershipPermissions = useMemo(() => {
        const myUserID = user?.userID;
        if (!myUserID) return [];
        return Object.values(permissions).filter(
            (permission) =>
                permission.resourceID === serverID &&
                permission.userID === myUserID,
        );
    }, [permissions, serverID, user?.userID]);
    const serverPowerLevel = useMemo(() => {
        if (membershipPermissions.length === 0) {
            return 0;
        }
        return Math.max(
            ...membershipPermissions.map((permission) => permission.powerLevel),
        );
    }, [membershipPermissions]);
    const canCreateChannelByRole = serverPowerLevel >= 50;
    const canDeleteServerByRole = serverPowerLevel >= 100;
    const canManageInvitesByRole = membershipPermissions.length > 0;

    const canCreateChannel = useMemo(
        () => channelName.trim().length > 0 && !creatingChannel,
        [channelName, creatingChannel],
    );

    async function handleCreateChannel(): Promise<void> {
        if (!canCreateChannelByRole) {
            return;
        }
        const nextName = channelName.trim();
        if (!nextName || creatingChannel) {
            return;
        }
        setCreatingChannel(true);
        setCreateChannelError("");
        try {
            const result = await vexService.createChannel(nextName, serverID);
            if (!result.ok) {
                setCreateChannelError(
                    result.error ?? "Failed to create channel.",
                );
                return;
            }
            setChannelName("");
            const updatedChannels = $channels.get()[serverID] ?? [];
            const created = updatedChannels[updatedChannels.length - 1];
            if (created) {
                navigation.replace("Channel", {
                    channelID: created.channelID,
                    channelName: created.name,
                    serverID,
                });
            }
        } finally {
            setCreatingChannel(false);
        }
    }

    function confirmDeleteServer(): void {
        if (!canDeleteServerByRole) {
            return;
        }
        Alert.alert(
            "Delete server?",
            `Delete ${serverName}? This cannot be undone.`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void handleDeleteServer();
                    },
                    style: "destructive",
                    text: deletingServer ? "Deleting..." : "Delete server",
                },
            ],
        );
    }

    async function handleDeleteServer(): Promise<void> {
        if (deletingServer) return;
        setDeletingServer(true);
        try {
            const result = await vexService.deleteServer(serverID);
            if (!result.ok) {
                Alert.alert(
                    "Delete failed",
                    result.error ?? "Failed to delete server.",
                );
                return;
            }
            navigation.reset({
                index: 0,
                routes: [{ name: "DMList" }],
            });
        } finally {
            setDeletingServer(false);
        }
    }

    function confirmLeaveServer(): void {
        if (leavingServer) {
            return;
        }
        Alert.alert(
            "Leave group?",
            `Leave ${serverName}? You will need an invite to rejoin.`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void handleLeaveServer();
                    },
                    style: "destructive",
                    text: "Leave group",
                },
            ],
        );
    }

    async function handleLeaveServer(): Promise<void> {
        if (leavingServer) return;
        setLeavingServer(true);
        try {
            const result = await vexService.leaveServer(serverID);
            if (!result.ok) {
                Alert.alert(
                    "Leave failed",
                    result.error ?? "Failed to leave group.",
                );
                return;
            }
            navigation.reset({
                index: 0,
                routes: [{ name: "DMList" }],
            });
        } finally {
            setLeavingServer(false);
        }
    }

    return (
        <View style={styles.container}>
            <ChatHeader title={`${serverName} settings`} />
            <ScrollView
                contentContainerStyle={styles.content}
                style={styles.scroller}
            >
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Channels</Text>
                    <Text style={styles.sectionHint}>
                        {channels.length} existing channel
                        {channels.length === 1 ? "" : "s"}
                    </Text>
                    {canCreateChannelByRole ? (
                        <>
                            <View style={styles.inputRow}>
                                <TextInput
                                    autoCapitalize="none"
                                    editable={!creatingChannel}
                                    onChangeText={setChannelName}
                                    placeholder="new-channel-name"
                                    placeholderTextColor={colors.mutedDark}
                                    style={styles.input}
                                    value={channelName}
                                />
                                <TouchableOpacity
                                    disabled={!canCreateChannel}
                                    onPress={() => {
                                        void handleCreateChannel();
                                    }}
                                    style={[
                                        styles.button,
                                        styles.buttonPrimary,
                                        !canCreateChannel &&
                                            styles.buttonDisabled,
                                    ]}
                                >
                                    <Text style={styles.buttonPrimaryText}>
                                        {creatingChannel
                                            ? "Creating..."
                                            : "Create"}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                            {createChannelError !== "" ? (
                                <Text style={styles.errorText}>
                                    {createChannelError}
                                </Text>
                            ) : null}
                        </>
                    ) : (
                        <Text style={styles.sectionHint}>
                            Requires moderator power level (50+).
                        </Text>
                    )}
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Invites</Text>
                    {canManageInvitesByRole ? (
                        <TouchableOpacity
                            onPress={() => {
                                navigation.navigate("Invite", {
                                    serverID,
                                    serverName,
                                });
                            }}
                            style={[styles.button, styles.buttonSecondary]}
                        >
                            <Text style={styles.buttonSecondaryText}>
                                Manage invite links
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.sectionHint}>
                            Requires member access.
                        </Text>
                    )}
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Membership</Text>
                    <TouchableOpacity
                        disabled={leavingServer}
                        onPress={confirmLeaveServer}
                        style={[
                            styles.button,
                            styles.buttonDanger,
                            leavingServer && styles.buttonDisabled,
                        ]}
                    >
                        <Text style={styles.buttonDangerText}>
                            {leavingServer ? "Leaving..." : "Leave group"}
                        </Text>
                    </TouchableOpacity>
                </View>

                {canDeleteServerByRole ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Danger zone</Text>
                        <TouchableOpacity
                            disabled={deletingServer}
                            onPress={confirmDeleteServer}
                            style={[
                                styles.button,
                                styles.buttonDanger,
                                deletingServer && styles.buttonDisabled,
                            ]}
                        >
                            <Text style={styles.buttonDangerText}>
                                {deletingServer
                                    ? "Deleting..."
                                    : "Delete server"}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : null}

                {!canManageInvitesByRole &&
                !canCreateChannelByRole &&
                !canDeleteServerByRole ? (
                    <Text style={styles.sectionHint}>
                        You do not have permission to manage this server.
                    </Text>
                ) : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: "center",
        borderRadius: 10,
        borderWidth: 1,
        minHeight: 40,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    buttonDanger: {
        borderColor: colors.dangerBorder,
    },
    buttonDangerText: {
        ...typography.button,
        color: colors.error,
    },
    buttonDisabled: {
        opacity: 0.4,
    },
    buttonPrimary: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    buttonPrimaryText: {
        ...typography.button,
        color: "#fff",
    },
    buttonSecondary: {
        borderColor: "rgba(255,255,255,0.2)",
    },
    buttonSecondaryText: {
        ...typography.button,
        color: colors.textSecondary,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        gap: 16,
        padding: 14,
        paddingBottom: 28,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        fontSize: 12,
        marginTop: 8,
    },
    input: {
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 10,
        borderWidth: 1,
        color: colors.textSecondary,
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    inputRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        marginTop: 8,
    },
    scroller: {
        flex: 1,
    },
    section: {
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
        padding: 12,
    },
    sectionHint: {
        ...typography.body,
        color: "rgba(255,255,255,0.56)",
        fontSize: 12,
    },
    sectionTitle: {
        ...typography.label,
        color: "rgba(255,255,255,0.72)",
    },
});
