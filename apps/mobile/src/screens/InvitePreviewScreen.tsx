import type { AppScreenProps } from "../navigation/types";
import type { InvitePreview } from "@vex-chat/store";

import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";

import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { navigateToJoinedServer } from "../navigation/navigationRef";
import { colors, fontFamilies, typography } from "../theme";

interface InviteJoinState {
    inviteID: string;
    value: JoinState;
}
interface InvitePreviewLoadState {
    error: string;
    inviteID: string;
    loading: boolean;
    preview: InvitePreview | null;
}

type JoinState = "idle" | "joined" | "joining";

export function InvitePreviewScreen({
    navigation,
    route,
}: AppScreenProps<"InvitePreview">) {
    const { inviteID } = route.params;
    const [joinState, setJoinState] = useState<InviteJoinState>({
        inviteID,
        value: "idle",
    });
    const [previewState, setPreviewState] = useState<InvitePreviewLoadState>({
        error: "",
        inviteID,
        loading: true,
        preview: null,
    });

    useEffect(() => {
        let cancelled = false;

        vexService
            .previewInvite(inviteID)
            .then((nextPreview) => {
                if (cancelled) return;
                setPreviewState({
                    error:
                        nextPreview == null
                            ? "This invite could not be found or has expired."
                            : "",
                    inviteID,
                    loading: false,
                    preview: nextPreview,
                });
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setPreviewState({
                    error:
                        err instanceof Error
                            ? err.message
                            : "Unable to load invite preview.",
                    inviteID,
                    loading: false,
                    preview: null,
                });
            });

        return () => {
            cancelled = true;
        };
    }, [inviteID]);

    const isCurrentPreview = previewState.inviteID === inviteID;
    const preview = isCurrentPreview ? previewState.preview : null;
    const loading = !isCurrentPreview || previewState.loading;
    const error = isCurrentPreview ? previewState.error : "";
    const currentJoinState =
        joinState.inviteID === inviteID ? joinState.value : "idle";
    const channelSummary = useMemo(
        () => (preview ? formatChannelSummary(preview.channels) : ""),
        [preview],
    );
    const expiration = preview
        ? formatInviteExpiration(preview.invite.expiration)
        : "";
    const serverName = preview?.server?.name ?? "Server invite";
    const serverID = preview?.server?.serverID ?? preview?.invite.serverID;
    const canJoin = preview != null && currentJoinState !== "joining";

    async function handleJoin(): Promise<void> {
        if (!canJoin) return;
        setPreviewState((current) => ({ ...current, error: "" }));
        setJoinState({ inviteID, value: "joining" });
        const result = await vexService.joinInvite(inviteID);
        if (!result.ok) {
            setPreviewState((current) => ({
                ...current,
                error: result.error ?? "Unable to join this group.",
            }));
            setJoinState({ inviteID, value: "idle" });
            return;
        }
        setJoinState({ inviteID, value: "joined" });
        if (navigateToJoinedServer(result)) {
            return;
        }
        dismissInvite();
    }

    function dismissInvite(): void {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate("DMList");
    }

    return (
        <ScreenLayout>
            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.header}>
                    <View style={styles.iconBadge}>
                        <Ionicons
                            color={colors.accentMuted}
                            name="link-outline"
                            size={26}
                        />
                    </View>
                    <Text style={styles.eyebrow}>Invite preview</Text>
                    <Text numberOfLines={2} style={styles.heading}>
                        {serverName}
                    </Text>
                    <Text style={styles.subtitle}>
                        Review this group before joining.
                    </Text>
                </View>

                <CornerBracketBox color={colors.border} size={10}>
                    <View style={styles.panel}>
                        {loading ? (
                            <View style={styles.loading}>
                                <ActivityIndicator
                                    color={colors.accentMuted}
                                    size="large"
                                />
                                <Text style={styles.muted}>
                                    Loading invite metadata
                                </Text>
                            </View>
                        ) : (
                            <>
                                <MetadataRow
                                    icon="people-outline"
                                    label="Group"
                                    value={serverName}
                                />
                                <MetadataRow
                                    icon="chatbubbles-outline"
                                    label="Channels"
                                    value={channelSummary || "Unavailable"}
                                />
                                <MetadataRow
                                    icon="time-outline"
                                    label="Expires"
                                    value={expiration || "Unavailable"}
                                />
                                <MetadataRow
                                    icon="finger-print-outline"
                                    label="Invite code"
                                    mono
                                    value={inviteID}
                                />
                                <MetadataRow
                                    icon="server-outline"
                                    label="Server ID"
                                    mono
                                    value={serverID ?? "Unavailable"}
                                />
                                {preview?.invite.owner ? (
                                    <MetadataRow
                                        icon="person-outline"
                                        label="Created by"
                                        mono
                                        value={preview.invite.owner}
                                    />
                                ) : null}
                            </>
                        )}
                    </View>
                </CornerBracketBox>

                {error ? (
                    <View style={styles.errorBox}>
                        <Ionicons
                            color={colors.error}
                            name="warning-outline"
                            size={18}
                        />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.actions}>
                    <VexButton
                        onPress={dismissInvite}
                        style={styles.actionButton}
                        title="Reject"
                        variant="outline"
                    />
                    <VexButton
                        disabled={!canJoin}
                        glow
                        loading={currentJoinState === "joining"}
                        onPress={() => void handleJoin()}
                        style={styles.actionButton}
                        title="Join group"
                    />
                </View>
            </ScrollView>
        </ScreenLayout>
    );
}

function formatChannelSummary(channels: InvitePreview["channels"]): string {
    if (channels.length === 0) {
        return "No channels listed";
    }
    const names = channels
        .slice(0, 4)
        .map((channel) => `#${channel.name}`)
        .join(", ");
    const extra = channels.length > 4 ? ` +${channels.length - 4} more` : "";
    return `${names}${extra}`;
}

function formatInviteExpiration(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unavailable";
    }
    const day = date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
    const time = date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    return `${day} at ${time}`;
}

function MetadataRow({
    icon,
    label,
    mono = false,
    value,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    mono?: boolean;
    value: string;
}) {
    return (
        <View style={styles.metadataRow}>
            <View style={styles.metadataIcon}>
                <Ionicons color={colors.muted} name={icon} size={16} />
            </View>
            <View style={styles.metadataText}>
                <Text style={styles.metadataLabel}>{label}</Text>
                <Text
                    numberOfLines={mono ? 2 : 1}
                    selectable={mono}
                    style={[styles.metadataValue, mono && styles.mono]}
                >
                    {value}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    actionButton: {
        width: "100%",
    },
    actions: {
        gap: 12,
        width: "100%",
    },
    content: {
        flexGrow: 1,
        gap: 22,
        justifyContent: "center",
        paddingVertical: 24,
    },
    errorBox: {
        alignItems: "center",
        backgroundColor: colors.dangerBg,
        borderColor: colors.error,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        padding: 12,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        flex: 1,
    },
    eyebrow: {
        ...typography.label,
        color: colors.accentMuted,
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
    iconBadge: {
        alignItems: "center",
        backgroundColor: "rgba(231,0,0,0.12)",
        borderColor: "rgba(255,107,107,0.34)",
        borderRadius: 12,
        borderWidth: 1,
        height: 52,
        justifyContent: "center",
        width: 52,
    },
    loading: {
        alignItems: "center",
        gap: 12,
        paddingVertical: 28,
    },
    metadataIcon: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    metadataLabel: {
        ...typography.label,
        color: colors.mutedDark,
        fontSize: 10,
    },
    metadataRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
    },
    metadataText: {
        flex: 1,
        gap: 3,
        minWidth: 0,
    },
    metadataValue: {
        ...typography.body,
        color: colors.textSecondary,
    },
    mono: {
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        lineHeight: 17,
    },
    muted: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
    panel: {
        backgroundColor: colors.surface,
        gap: 16,
        padding: 16,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
});
