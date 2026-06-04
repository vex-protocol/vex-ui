import type { IncomingShareItem } from "../lib/shareIntent";
import type { AppScreenProps } from "../navigation/types";
import type { User } from "@vex-chat/libvex";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {
    $channels,
    $familiars,
    $servers,
    formatFileAttachmentMarkdown,
    formatFileSize,
    isImageType,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../components/Avatar";
import { ChatHeader } from "../components/ChatHeader";
import { localFileAttachmentFromUri } from "../lib/attachments";
import { haptic } from "../lib/haptics";
import { $incomingShare } from "../lib/incomingShareState";
import { clearIncomingShareIntent } from "../lib/shareIntent";
import { colors, typography } from "../theme";

type RecipientTarget =
    | {
          channelID: string;
          channelName: string;
          key: string;
          kind: "channel";
          serverID: string;
          serverName: string;
          subtitle: string;
          title: string;
      }
    | {
          key: string;
          kind: "dm";
          subtitle: string;
          title: string;
          userID: string;
          username: string;
      };

export function ShareComposerScreen({
    navigation,
}: AppScreenProps<"ShareComposer">) {
    const insets = useSafeAreaInsets();
    const share = useStore($incomingShare);
    const familiars = useStore($familiars);
    const channels = useStore($channels);
    const servers = useStore($servers);
    const [caption, setCaption] = useState("");
    const [error, setError] = useState("");
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
        () => new Set(),
    );
    const [sentKeys, setSentKeys] = useState<Set<string>>(() => new Set());
    const [sending, setSending] = useState(false);

    useEffect(() => {
        setCaption(share?.text ?? "");
        setSelectedKeys(new Set());
        setSentKeys(new Set());
        setError("");
    }, [share?.id, share?.text]);

    const targets = useMemo<RecipientTarget[]>(() => {
        const dmTargets = Object.values(familiars)
            .sort(compareUsers)
            .map<RecipientTarget>((user) => ({
                key: `dm:${user.userID}`,
                kind: "dm",
                subtitle: `@${user.username}`,
                title: user.username,
                userID: user.userID,
                username: user.username,
            }));

        const channelTargets = Object.entries(channels)
            .flatMap(([serverID, serverChannels]) => {
                const serverName = servers[serverID]?.name ?? "Server";
                return serverChannels.map<RecipientTarget>((channel) => ({
                    channelID: channel.channelID,
                    channelName: channel.name,
                    key: `channel:${channel.channelID}`,
                    kind: "channel",
                    serverID,
                    serverName,
                    subtitle: serverName,
                    title: `#${channel.name}`,
                }));
            })
            .sort((a, b) =>
                `${a.subtitle} ${a.title}`.localeCompare(
                    `${b.subtitle} ${b.title}`,
                ),
            );

        return [...dmTargets, ...channelTargets];
    }, [channels, familiars, servers]);

    const selectedTargets = useMemo(
        () => targets.filter((target) => selectedKeys.has(target.key)),
        [selectedKeys, targets],
    );

    const pendingTargets = useMemo(
        () => selectedTargets.filter((target) => !sentKeys.has(target.key)),
        [selectedTargets, sentKeys],
    );

    const firstItem = share?.items[0];
    const imagePreview =
        firstItem && isImageType(firstItem.contentType) ? firstItem : null;

    const dismissShare = useCallback(() => {
        const shareID = share?.id;
        $incomingShare.set(null);
        if (shareID) {
            void clearIncomingShareIntent(shareID).catch(() => {});
        }
        navigation.replace("DMList");
    }, [navigation, share?.id]);

    const toggleTarget = useCallback((target: RecipientTarget) => {
        haptic("selection");
        setSelectedKeys((previous) => {
            const next = new Set(previous);
            if (next.has(target.key)) {
                next.delete(target.key);
            } else {
                next.add(target.key);
            }
            return next;
        });
    }, []);

    const sendShare = useCallback(() => {
        if (!share || pendingTargets.length === 0 || sending) {
            return;
        }

        void (async () => {
            setSending(true);
            setError("");
            try {
                const markdownParts: string[] = [];
                for (const item of share.items) {
                    const attachment = await localFileAttachmentFromUri(item);
                    const uploaded = await vexService.uploadFileAttachment({
                        contentType: attachment.contentType,
                        data: attachment.data,
                        fileName: attachment.fileName,
                        fileSize: attachment.fileSize,
                    });
                    if (!uploaded.ok || !uploaded.attachment) {
                        throw new Error(
                            uploaded.error ?? "Failed to upload attachment",
                        );
                    }
                    markdownParts.push(
                        formatFileAttachmentMarkdown(uploaded.attachment),
                    );
                }

                const body = [caption.trim(), ...markdownParts]
                    .filter(Boolean)
                    .join("\n\n");
                if (!body) {
                    throw new Error("Nothing to share.");
                }

                for (const target of pendingTargets) {
                    const result =
                        target.kind === "dm"
                            ? await vexService.sendDM(target.userID, body)
                            : await vexService.sendGroupMessage(
                                  target.channelID,
                                  body,
                              );
                    if (!result.ok) {
                        throw new Error(
                            `Failed sending to ${target.title}: ${
                                result.error ?? "send failed"
                            }`,
                        );
                    }
                    setSentKeys((previous) => {
                        const next = new Set(previous);
                        next.add(target.key);
                        return next;
                    });
                }

                haptic("success");
                await clearIncomingShareIntent(share.id).catch(() => {});
                $incomingShare.set(null);
                const firstTarget = pendingTargets[0];
                if (pendingTargets.length === 1 && firstTarget) {
                    if (firstTarget.kind === "dm") {
                        navigation.replace("Conversation", {
                            userID: firstTarget.userID,
                            username: firstTarget.username,
                        });
                    } else {
                        navigation.replace("Channel", {
                            channelID: firstTarget.channelID,
                            channelName: firstTarget.channelName,
                            serverID: firstTarget.serverID,
                        });
                    }
                    return;
                }
                navigation.replace("DMList");
            } catch (err: unknown) {
                haptic("error");
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not send shared content",
                );
            } finally {
                setSending(false);
            }
        })();
    }, [caption, navigation, pendingTargets, sending, share]);

    if (!share) {
        return (
            <View style={styles.container}>
                <ChatHeader onBack={dismissShare} title="Share to Vex" />
                <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>No share pending</Text>
                    <Text style={styles.emptyText}>
                        Pick Vex from Android share to send content here.
                    </Text>
                </View>
            </View>
        );
    }

    function renderTarget({ item }: { item: RecipientTarget }) {
        const selected = selectedKeys.has(item.key);
        const sent = sentKeys.has(item.key);
        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: sent || sending, selected }}
                disabled={sent || sending}
                onPress={() => {
                    toggleTarget(item);
                }}
                style={[
                    styles.targetRow,
                    selected ? styles.targetRowSelected : null,
                    sent ? styles.targetRowSent : null,
                ]}
            >
                {item.kind === "dm" ? (
                    <Avatar
                        displayName={item.username}
                        size={38}
                        userID={item.userID}
                    />
                ) : (
                    <View style={styles.channelIcon}>
                        <Ionicons
                            color={colors.textSecondary}
                            name="chatbubbles-outline"
                            size={19}
                        />
                    </View>
                )}
                <View style={styles.targetCopy}>
                    <Text numberOfLines={1} style={styles.targetTitle}>
                        {item.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.targetSubtitle}>
                        {item.subtitle}
                    </Text>
                </View>
                <View
                    style={[
                        styles.check,
                        selected ? styles.checkSelected : null,
                    ]}
                >
                    {(selected || sent) && (
                        <Ionicons color="#130E0E" name="checkmark" size={16} />
                    )}
                </View>
            </TouchableOpacity>
        );
    }

    return (
        <View style={styles.container}>
            <ChatHeader onBack={dismissShare} title="Share to Vex" />

            <FlatList
                contentContainerStyle={[
                    styles.listContent,
                    { paddingBottom: insets.bottom + 88 },
                ]}
                data={targets}
                extraData={selectedKeys}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item) => item.key}
                ListEmptyComponent={
                    <View style={styles.emptyTargets}>
                        <Text style={styles.emptyTitle}>No recipients yet</Text>
                        <Text style={styles.emptyText}>
                            Add a familiar or join a channel before sharing.
                        </Text>
                    </View>
                }
                ListHeaderComponent={
                    <SharePreview
                        caption={caption}
                        imagePreview={imagePreview}
                        itemCount={share.items.length}
                        onCaptionChange={setCaption}
                        sharedItems={share.items}
                    />
                }
                renderItem={renderTarget}
            />

            {error !== "" && (
                <View style={styles.errorBar}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            <View
                style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}
            >
                <Pressable
                    accessibilityRole="button"
                    disabled={sending || pendingTargets.length === 0}
                    onPress={sendShare}
                    style={[
                        styles.sendButton,
                        pendingTargets.length === 0 || sending
                            ? styles.sendButtonDisabled
                            : null,
                    ]}
                >
                    {sending ? (
                        <ActivityIndicator color="#180F0F" size="small" />
                    ) : (
                        <>
                            <Ionicons color="#180F0F" name="send" size={16} />
                            <Text style={styles.sendButtonText}>
                                Send
                                {pendingTargets.length > 0
                                    ? ` to ${pendingTargets.length}`
                                    : ""}
                            </Text>
                        </>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

function compareUsers(a: User, b: User): number {
    return a.username.localeCompare(b.username);
}

function previewMeta(items: IncomingShareItem[], itemCount: number): string {
    const first = items[0];
    if (!first) {
        return "Text";
    }
    const size =
        first.fileSize === undefined ? "" : formatFileSize(first.fileSize);
    const count = itemCount > 1 ? `${itemCount} items` : first.contentType;
    return size ? `${count} | ${size}` : count;
}

function SharePreview({
    caption,
    imagePreview,
    itemCount,
    onCaptionChange,
    sharedItems,
}: {
    caption: string;
    imagePreview: IncomingShareItem | null;
    itemCount: number;
    onCaptionChange: (value: string) => void;
    sharedItems: IncomingShareItem[];
}) {
    const firstItem = sharedItems[0];
    return (
        <View style={styles.previewWrap}>
            <View style={styles.previewRow}>
                {imagePreview ? (
                    <Image
                        source={{ uri: imagePreview.uri }}
                        style={styles.previewImage}
                    />
                ) : (
                    <View style={styles.filePreviewIcon}>
                        <Ionicons
                            color={colors.textSecondary}
                            name="document-attach-outline"
                            size={24}
                        />
                    </View>
                )}
                <View style={styles.previewCopy}>
                    <Text numberOfLines={1} style={styles.previewTitle}>
                        {firstItem?.fileName ?? "Shared text"}
                    </Text>
                    <Text numberOfLines={1} style={styles.previewMeta}>
                        {previewMeta(sharedItems, itemCount)}
                    </Text>
                </View>
            </View>
            <TextInput
                multiline
                onChangeText={onCaptionChange}
                placeholder="Add a message"
                placeholderTextColor={colors.mutedDark}
                style={styles.captionInput}
                value={caption}
            />
            <Text style={styles.sectionLabel}>Send to</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    captionInput: {
        ...typography.bodyLarge,
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        color: colors.text,
        minHeight: 64,
        paddingHorizontal: 12,
        paddingVertical: 10,
        textAlignVertical: "top",
    },
    channelIcon: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 19,
        borderWidth: 1,
        height: 38,
        justifyContent: "center",
        width: 38,
    },
    check: {
        alignItems: "center",
        borderColor: colors.border,
        borderRadius: 10,
        borderWidth: 1,
        height: 20,
        justifyContent: "center",
        width: 20,
    },
    checkSelected: {
        backgroundColor: colors.accentMuted,
        borderColor: colors.accentMuted,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    empty: {
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    emptyTargets: {
        alignItems: "center",
        paddingHorizontal: 24,
        paddingVertical: 42,
    },
    emptyText: {
        ...typography.body,
        color: colors.muted,
        marginTop: 6,
        textAlign: "center",
    },
    emptyTitle: {
        ...typography.button,
        color: colors.text,
    },
    errorBar: {
        backgroundColor: colors.dangerBg,
        borderTopColor: colors.dangerBorder,
        borderTopWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    filePreviewIcon: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        height: 64,
        justifyContent: "center",
        width: 64,
    },
    footer: {
        backgroundColor: colors.bg,
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        bottom: 0,
        left: 0,
        paddingHorizontal: 14,
        paddingTop: 10,
        position: "absolute",
        right: 0,
    },
    listContent: {
        paddingHorizontal: 14,
        paddingTop: 14,
    },
    previewCopy: {
        flex: 1,
        minWidth: 0,
    },
    previewImage: {
        backgroundColor: colors.surfaceLight,
        borderRadius: 8,
        height: 64,
        width: 64,
    },
    previewMeta: {
        ...typography.body,
        color: colors.muted,
        marginTop: 2,
    },
    previewRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
    },
    previewTitle: {
        ...typography.button,
        color: colors.text,
    },
    previewWrap: {
        gap: 12,
        paddingBottom: 10,
    },
    sectionLabel: {
        ...typography.label,
        color: colors.mutedDark,
        marginTop: 4,
    },
    sendButton: {
        alignItems: "center",
        backgroundColor: colors.accentMuted,
        borderRadius: 8,
        flexDirection: "row",
        gap: 8,
        height: 44,
        justifyContent: "center",
    },
    sendButtonDisabled: {
        opacity: 0.44,
    },
    sendButtonText: {
        ...typography.button,
        color: "#180F0F",
        fontWeight: "800",
    },
    targetCopy: {
        flex: 1,
        minWidth: 0,
    },
    targetRow: {
        alignItems: "center",
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    targetRowSelected: {
        backgroundColor: "rgba(255,107,107,0.12)",
        borderColor: "rgba(255,107,107,0.52)",
    },
    targetRowSent: {
        opacity: 0.58,
    },
    targetSubtitle: {
        ...typography.body,
        color: colors.muted,
    },
    targetTitle: {
        ...typography.button,
        color: colors.text,
    },
});
