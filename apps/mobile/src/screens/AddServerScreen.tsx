import type { AppStackParamList } from "../navigation/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { parseInviteID } from "@vex-chat/store";
import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { navigateToJoinedServer } from "../navigation/navigationRef";
import { colors, typography } from "../theme";

export function AddServerScreen() {
    const navigation =
        useNavigation<
            NativeStackNavigationProp<AppStackParamList, "AddServer">
        >();
    const [mode, setMode] = useState<"create" | "join" | "pick">("pick");
    const [name, setName] = useState("");
    const [inviteInput, setInviteInput] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleCreate() {
        if (!name.trim()) return;
        setLoading(true);
        setError("");
        try {
            const result = await vexService.createServer(name.trim());
            if (!result.ok) {
                setError(result.error || "Failed to create server");
                return;
            }
            if (!result.serverID) {
                if (navigation.canGoBack()) navigation.goBack();
                return;
            }
            if (result.channelID && result.channelName) {
                navigation.navigate("Channel", {
                    channelID: result.channelID,
                    channelName: result.channelName,
                    serverID: result.serverID,
                });
                return;
            }
            navigation.navigate("ChannelList", {
                serverID: result.serverID,
                ...(result.serverName ? { serverName: result.serverName } : {}),
            });
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Failed to create server",
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleJoin() {
        const inviteID = parseInviteID(inviteInput);
        if (!inviteID) {
            setError("Please enter a valid invite link or code");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok) {
                setError(result.error || "Failed to join server");
                setLoading(false);
                return;
            }
            if (navigateToJoinedServer(result)) {
                return;
            }
            if (navigation.canGoBack()) {
                navigation.goBack();
                return;
            }
            setLoading(false);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Failed to join server",
            );
            setLoading(false);
        }
    }

    if (mode === "pick") {
        return (
            <ScreenLayout glows>
                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.kicker}>NEW GROUP</Text>
                        <Text style={styles.heading}>Create or join</Text>
                        <Text style={styles.subtitle}>
                            Encrypted from the first message. Only members hold
                            the keys.
                        </Text>
                    </View>
                    <View style={styles.options}>
                        <VexButton
                            glow
                            icon="add"
                            onPress={() => {
                                setMode("create");
                            }}
                            title="Create group"
                        />
                        <VexButton
                            icon="link-outline"
                            onPress={() => {
                                setMode("join");
                            }}
                            title="Join via invite"
                            variant="outline"
                        />
                    </View>
                </View>
            </ScreenLayout>
        );
    }

    if (mode === "create") {
        return (
            <ScreenLayout glows>
                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.kicker}>NEW GROUP</Text>
                        <Text style={styles.heading}>Create Group</Text>
                        <Text style={styles.subtitle}>
                            Encrypted from the first message. Only members hold
                            the keys.
                        </Text>
                    </View>

                    {error ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <View style={styles.groupIconWrap}>
                        <CornerBracketBox color={colors.border} size={8}>
                            <View style={styles.groupIconBox}>
                                <Ionicons
                                    color={colors.muted}
                                    name="camera-outline"
                                    size={26}
                                />
                            </View>
                        </CornerBracketBox>
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>GROUP NAME</Text>
                        <CornerBracketBox color={colors.border} size={8}>
                            <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(t) => {
                                    setName(t);
                                    setError("");
                                }}
                                placeholder="My server"
                                placeholderTextColor={colors.mutedDark}
                                style={styles.input}
                                value={name}
                            />
                        </CornerBracketBox>
                    </View>

                    <View style={styles.buttonRow}>
                        <VexButton
                            disabled={!name.trim()}
                            glow
                            icon="add"
                            loading={loading}
                            onPress={() => void handleCreate()}
                            title="Create group"
                        />
                    </View>
                </View>
            </ScreenLayout>
        );
    }

    // mode === 'join'
    return (
        <ScreenLayout glows>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.kicker}>INVITE CODE</Text>
                    <Text style={styles.heading}>Join Group</Text>
                    <Text style={styles.subtitle}>
                        Enter an invite link or code
                    </Text>
                </View>

                {error ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.field}>
                    <Text style={styles.label}>INVITE CODE</Text>
                    <CornerBracketBox color={colors.border} size={8}>
                        <TextInput
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!loading}
                            onChangeText={(t) => {
                                setInviteInput(t);
                                setError("");
                            }}
                            placeholder="Paste invite link or code"
                            placeholderTextColor={colors.mutedDark}
                            style={styles.input}
                            value={inviteInput}
                        />
                    </CornerBracketBox>
                </View>

                <View style={styles.buttonRow}>
                    <VexButton
                        disabled={!inviteInput.trim()}
                        glow
                        icon="link-outline"
                        loading={loading}
                        onPress={() => void handleJoin()}
                        title="Join group"
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    buttonRow: {
        alignItems: "center",
    },
    content: {
        flex: 1,
        gap: 24,
        justifyContent: "flex-start",
        paddingTop: 18,
    },
    errorBox: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.error,
        borderWidth: 1,
        padding: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    field: {
        gap: 6,
    },
    groupIconBox: {
        alignItems: "center",
        backgroundColor: colors.surface,
        height: 84,
        justifyContent: "center",
        width: 84,
    },
    groupIconWrap: {
        alignItems: "center",
    },
    header: {
        alignItems: "center",
        gap: 8,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
        textAlign: "center",
    },
    input: {
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        color: colors.textSecondary,
        fontSize: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    kicker: {
        ...typography.label,
        color: colors.accent,
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
    options: {
        alignItems: "center",
        gap: 12,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
});
