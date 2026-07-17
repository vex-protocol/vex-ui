import type { InvitePreview } from "@vex-chat/store";

import React from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";

import { haptic } from "../lib/haptics";
import { navigateToJoinedServer } from "../navigation/navigationRef";
import { colors, fontFamilies, typography, useAccentColors } from "../theme";

interface InvitePreviewCardProps {
    inviteID: string;
    isOwn?: boolean;
}

type JoinState = "error" | "idle" | "joined" | "joining";

export function InvitePreviewCard({
    inviteID,
    isOwn = false,
}: InvitePreviewCardProps) {
    const accent = useAccentColors();
    const [error, setError] = React.useState("");
    const [joinState, setJoinState] = React.useState<JoinState>("idle");
    const [loading, setLoading] = React.useState(true);
    const [preview, setPreview] = React.useState<InvitePreview | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        setError("");
        setJoinState("idle");
        setLoading(true);
        setPreview(null);

        vexService
            .previewInvite(inviteID)
            .then((nextPreview) => {
                if (!cancelled) {
                    setPreview(nextPreview);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPreview(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [inviteID]);

    const handleJoin = async () => {
        if (!preview || joinState === "joining" || joinState === "joined") {
            return;
        }
        setError("");
        setJoinState("joining");
        haptic("confirm");
        const result = await vexService.joinInvite(inviteID);
        if (result.ok) {
            setJoinState("joined");
            haptic("success");
            navigateToJoinedServer(result);
            return;
        }
        setError(result.error ?? "Unable to join");
        setJoinState("error");
        haptic("error");
    };

    if (!loading && preview === null) {
        return null;
    }

    const serverName = preview?.server?.name ?? "Server invite";
    const channelSummary = preview
        ? formatChannelSummary(preview.channels)
        : "Loading invite";
    const expiration = preview
        ? formatInviteExpiration(preview.invite.expiration)
        : "";
    const isPreviewLoading = loading && preview === null;
    const buttonLabel = isPreviewLoading
        ? "Loading"
        : joinState === "joined"
          ? "Joined"
          : joinState === "joining"
            ? "Joining"
            : "Join";
    const buttonIcon = joinState === "joined" ? "checkmark" : "enter-outline";

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: accent.accentSoft,
                    borderColor: accent.accentBorder,
                },
                isOwn && { borderColor: accent.accentText },
            ]}
        >
            <View style={styles.header}>
                <View style={styles.iconBox}>
                    <Ionicons
                        color={accent.accentText}
                        name="link-outline"
                        size={18}
                    />
                </View>
                <View style={styles.titleColumn}>
                    <Text
                        style={[styles.eyebrow, { color: accent.accentText }]}
                    >
                        Server invite
                    </Text>
                    <Text numberOfLines={1} style={styles.serverName}>
                        {serverName}
                    </Text>
                </View>
            </View>

            <View style={styles.details}>
                <Text numberOfLines={1} style={styles.detailText}>
                    {channelSummary}
                </Text>
                {expiration ? (
                    <Text numberOfLines={1} style={styles.detailMuted}>
                        {expiration}
                    </Text>
                ) : null}
            </View>

            <View style={styles.footer}>
                {error ? (
                    <Text numberOfLines={1} style={styles.errorText}>
                        {error}
                    </Text>
                ) : (
                    <Text numberOfLines={1} style={styles.inviteCode}>
                        {shortInviteID(inviteID)}
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    disabled={
                        isPreviewLoading ||
                        !preview ||
                        joinState === "joining" ||
                        joinState === "joined"
                    }
                    onPress={() => void handleJoin()}
                    style={({ pressed }) => [
                        styles.joinButton,
                        { backgroundColor: accent.accent },
                        pressed && {
                            backgroundColor: accent.accentDark,
                        },
                        (isPreviewLoading ||
                            !preview ||
                            joinState === "joining" ||
                            joinState === "joined") &&
                            styles.joinButtonDisabled,
                    ]}
                >
                    {isPreviewLoading || joinState === "joining" ? (
                        <ActivityIndicator
                            color={accent.onAccent}
                            size="small"
                        />
                    ) : (
                        <Ionicons color={accent.onAccent} name={buttonIcon} />
                    )}
                    <Text style={[styles.joinText, { color: accent.onAccent }]}>
                        {buttonLabel}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

function formatChannelSummary(channels: InvitePreview["channels"]): string {
    if (channels.length === 0) {
        return "No channels listed";
    }
    const names = channels
        .slice(0, 3)
        .map((channel) => `#${channel.name}`)
        .join(", ");
    const extra = channels.length > 3 ? ` +${channels.length - 3} more` : "";
    return `${names}${extra}`;
}

function formatInviteExpiration(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Expiry unavailable";
    }
    const day = date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
    });
    const time = date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    return `Expires ${day} at ${time}`;
}

function shortInviteID(inviteID: string): string {
    return inviteID.length > 8 ? inviteID.slice(0, 8) : inviteID;
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 8,
        borderWidth: 1,
        gap: 8,
        marginTop: 8,
        maxWidth: 440,
        padding: 10,
    },
    detailMuted: {
        ...typography.body,
        color: colors.muted,
        flexShrink: 1,
    },
    details: {
        gap: 2,
    },
    detailText: {
        ...typography.body,
        color: colors.textSecondary,
        flexShrink: 1,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        flex: 1,
    },
    eyebrow: {
        ...typography.label,
        fontSize: 10,
        lineHeight: 13,
    },
    footer: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        justifyContent: "space-between",
    },
    header: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
    iconBox: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderRadius: 8,
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    inviteCode: {
        ...typography.body,
        color: colors.muted,
        flex: 1,
        fontFamily: fontFamilies.mono,
    },
    joinButton: {
        alignItems: "center",
        borderRadius: 6,
        flexDirection: "row",
        gap: 6,
        minHeight: 32,
        minWidth: 84,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    joinButtonDisabled: {
        opacity: 0.58,
    },
    joinText: {
        ...typography.button,
        fontSize: 13,
    },
    serverName: {
        ...typography.bodyLarge,
        color: colors.text,
        fontWeight: "700",
    },
    titleColumn: {
        flex: 1,
        minWidth: 0,
    },
});
