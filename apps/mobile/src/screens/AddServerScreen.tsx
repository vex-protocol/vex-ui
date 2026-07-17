import type { AppStackParamList } from "../navigation/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import React, { useEffect, useRef, useState } from "react";
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { parseInviteID } from "@vex-chat/store";
import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";

import { ChatHeader } from "../components/ChatHeader";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexField } from "../components/VexField";
import {
    $avatarCropResult,
    nextAvatarCropRequestId,
} from "../lib/avatarCropResult";
import { prepareServerIcon } from "../lib/serverIconImage";
import { navigateToJoinedServer } from "../navigation/navigationRef";
import { colors, typography, useAccentColors } from "../theme";

export function AddServerScreen() {
    const accent = useAccentColors();
    const navigation =
        useNavigation<
            NativeStackNavigationProp<AppStackParamList, "AddServer">
        >();
    const [mode, setMode] = useState<"create" | "join" | "pick">("pick");
    const cropResult = useStore($avatarCropResult);
    const expectedCropRequestRef = useRef<null | number>(null);
    const [iconUri, setIconUri] = useState<null | string>(null);
    const [name, setName] = useState("");
    const [inviteInput, setInviteInput] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (
            !cropResult ||
            cropResult.requestId !== expectedCropRequestRef.current
        ) {
            return;
        }
        expectedCropRequestRef.current = null;
        $avatarCropResult.set(null);
        setIconUri(cropResult.uri);
        setError("");
    }, [cropResult]);

    async function handlePickIcon(): Promise<void> {
        if (loading) return;
        const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            setError("Photo library permission is required.");
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.92,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset?.uri || (asset.type != null && asset.type !== "image")) {
            setError("Please select an image.");
            return;
        }
        if (
            typeof asset.width === "number" &&
            typeof asset.height === "number" &&
            Math.abs(asset.width - asset.height) > 1
        ) {
            const requestId = nextAvatarCropRequestId();
            expectedCropRequestRef.current = requestId;
            $avatarCropResult.set(null);
            navigation.navigate("AvatarCrop", {
                requestId,
                sourceHeight: asset.height,
                sourceUri: asset.uri,
                sourceWidth: asset.width,
                title: "Crop group icon",
            });
            return;
        }
        setIconUri(asset.uri);
        setError("");
    }

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
            if (iconUri) {
                try {
                    const icon = await prepareServerIcon(iconUri);
                    const iconResult = await vexService.setServerIcon(
                        result.serverID,
                        icon,
                    );
                    if (!iconResult.ok) {
                        throw new Error(
                            iconResult.error ?? "Failed to set group icon",
                        );
                    }
                } catch (err: unknown) {
                    await vexService.deleteServer(result.serverID);
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to set group icon",
                    );
                    return;
                }
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
                        <Text
                            style={[
                                styles.kicker,
                                { color: accent.accentText },
                            ]}
                        >
                            NEW GROUP
                        </Text>
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
            <VexField glows style={styles.container}>
                <ChatHeader title="Create Group" />
                <ScrollView
                    contentContainerStyle={styles.createScroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.createIntro}>
                        <Text
                            style={[
                                styles.kicker,
                                { color: accent.accentText },
                            ]}
                        >
                            NEW GROUP
                        </Text>
                        <Text style={styles.createSubtitle}>
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
                        <View style={styles.iconStage}>
                            <TouchableOpacity
                                accessibilityLabel="Choose group icon"
                                activeOpacity={0.78}
                                disabled={loading}
                                onPress={() => void handlePickIcon()}
                            >
                                <CornerBracketBox
                                    color={colors.border}
                                    size={8}
                                >
                                    <View style={styles.groupIconBox}>
                                        {iconUri ? (
                                            <Image
                                                source={{ uri: iconUri }}
                                                style={styles.groupIconImage}
                                            />
                                        ) : (
                                            <Ionicons
                                                color={colors.muted}
                                                name="camera-outline"
                                                size={26}
                                            />
                                        )}
                                    </View>
                                </CornerBracketBox>
                            </TouchableOpacity>
                            {iconUri ? (
                                <TouchableOpacity
                                    accessibilityLabel="Remove selected group icon"
                                    onPress={() => setIconUri(null)}
                                    style={styles.removeIconButton}
                                >
                                    <Ionicons
                                        color={colors.muted}
                                        name="close"
                                        size={18}
                                    />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                        <Text style={styles.iconHint}>
                            Group icon (optional)
                        </Text>
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>GROUP NAME</Text>
                        <CornerBracketBox color={colors.border} size={8}>
                            <TextInput
                                autoCapitalize="words"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(t) => {
                                    setName(t);
                                    setError("");
                                }}
                                placeholder="Field Operations"
                                placeholderTextColor={colors.mutedDark}
                                style={styles.input}
                                value={name}
                            />
                        </CornerBracketBox>
                    </View>

                    <View style={styles.privacyRow}>
                        <View style={styles.privacyIcon}>
                            <Ionicons
                                color={colors.success}
                                name="lock-closed-outline"
                                size={18}
                            />
                        </View>
                        <View style={styles.privacyCopy}>
                            <Text style={styles.privacyTitle}>Invite-only</Text>
                            <Text style={styles.privacyDescription}>
                                New members need an invite link.
                            </Text>
                        </View>
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
                </ScrollView>
            </VexField>
        );
    }

    // mode === 'join'
    return (
        <ScreenLayout glows>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={[styles.kicker, { color: accent.accentText }]}>
                        INVITE CODE
                    </Text>
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
        marginTop: 24,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        flex: 1,
        gap: 24,
        justifyContent: "flex-start",
        paddingTop: 18,
    },
    createIntro: {
        gap: 6,
        marginBottom: 18,
    },
    createScroll: {
        paddingBottom: 24,
        paddingHorizontal: 16,
        paddingTop: 18,
    },
    createSubtitle: {
        ...typography.body,
        color: colors.muted,
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
        gap: 8,
    },
    groupIconBox: {
        alignItems: "center",
        backgroundColor: colors.surface,
        borderRadius: 8,
        height: 84,
        justifyContent: "center",
        overflow: "hidden",
        width: 84,
    },
    groupIconImage: {
        height: 84,
        width: 84,
    },
    groupIconWrap: {
        alignItems: "center",
        gap: 8,
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
    iconHint: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 12,
    },
    iconStage: {
        position: "relative",
    },
    input: {
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        color: colors.textSecondary,
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
    },
    kicker: {
        ...typography.label,
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
    options: {
        alignItems: "center",
        gap: 12,
    },
    privacyCopy: {
        flex: 1,
        gap: 2,
    },
    privacyDescription: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 16,
    },
    privacyIcon: {
        alignItems: "center",
        backgroundColor: colors.successBg,
        borderRadius: 8,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    privacyRow: {
        alignItems: "center",
        borderColor: colors.borderSubtle,
        borderTopWidth: 1,
        flexDirection: "row",
        gap: 12,
        marginTop: 18,
        paddingTop: 16,
    },
    privacyTitle: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 14,
    },
    removeIconButton: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        height: 30,
        justifyContent: "center",
        position: "absolute",
        right: -10,
        top: 64,
        width: 30,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
});
