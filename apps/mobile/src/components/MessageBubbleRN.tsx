import type { Message } from "@vex-chat/libvex";
import type {
    EncryptedFileAttachment,
    MarkdownInlineSegment,
    MessageEmbed,
    MessageEmbedBlock,
    MessageEmbedMediaItem,
    MessageEmoji,
    MessageMarkdownNode,
    MessageReaction,
    MessageReplyReference,
} from "@vex-chat/store";
import type {
    DimensionValue,
    GestureResponderEvent,
    TextStyle,
} from "react-native";

import React from "react";
import {
    ActivityIndicator,
    Alert,
    Clipboard,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";

import {
    applyEmoji,
    buildMessageReplyReference,
    createUnicodeReactionEmoji,
    emojiReactionKey,
    emojiReactionLabel,
    extractInviteID,
    formatFileSize,
    formatTime,
    isImageType,
    messageEmbed,
    messageReactions,
    messageReply,
    parseMessageMarkdown,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";

import { bytesToBase64, writeAttachmentToCache } from "../lib/attachments";
import { openExternalUrl } from "../lib/externalLinks";
import { haptic } from "../lib/haptics";
import { type CodeHighlightKind, highlightCode } from "../lib/syntaxHighlight";
import { colors, fontFamilies, typography, useAccentColors } from "../theme";

import { Avatar } from "./Avatar";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { InvitePreviewCard } from "./InvitePreviewCard";
import { LinkPreviewCard } from "./LinkPreviewCard";

interface MessageBubbleRNProps {
    authorName: string;
    currentUserID?: string | undefined;
    isOwn: boolean;
    message: Message;
    onDeleteMessageForEveryone?: ((message: Message) => void) | undefined;
    onDeleteMessageForMe?: ((message: Message) => void) | undefined;
    onEditMessage?: ((message: Message) => void) | undefined;
    onPressReplyTarget?: ((mailID: string) => void) | undefined;
    onReplyMessage?: ((message: Message) => void) | undefined;
    onToggleReaction?:
        | ((message: Message, emoji: MessageEmoji) => void)
        | undefined;
    replyTarget?: MessageReplyTarget | null | undefined;
    showIdentity?: boolean;
}

interface MessageReplyTarget {
    authorName: string;
    message: Message;
}

const QUICK_REACTION_EMOJIS: MessageEmoji[] = [
    createUnicodeReactionEmoji("👍", "thumbsup"),
    createUnicodeReactionEmoji("🤍", "white_heart"),
    createUnicodeReactionEmoji("😹", "joycat"),
    createUnicodeReactionEmoji("🎉", "tada"),
    createUnicodeReactionEmoji("💯", "100"),
];

const PICKER_REACTION_VALUES = [
    "😀",
    "😃",
    "😄",
    "😁",
    "😆",
    "😅",
    "😂",
    "🤣",
    "😊",
    "😇",
    "🙂",
    "🙃",
    "😉",
    "😍",
    "🥰",
    "😘",
    "😎",
    "🤩",
    "🥳",
    "😋",
    "😜",
    "🤔",
    "🫡",
    "🤝",
    "👏",
    "🙌",
    "🙏",
    "💪",
    "🔥",
    "✨",
    "⭐",
    "💫",
    "⚡",
    "💥",
    "❤️",
    "🧡",
    "💛",
    "💚",
    "💙",
    "💜",
    "🖤",
    "🤍",
    "🤎",
    "💔",
    "💯",
    "✅",
    "☑️",
    "🎯",
    "🚀",
    "👀",
    "🫶",
    "🤌",
    "👌",
    "👍",
    "👎",
    "👋",
    "🎉",
    "🎊",
    "🏆",
    "🥇",
    "🍾",
    "☕",
    "🍕",
    "🌮",
    "🌈",
    "🌙",
    "☀️",
    "🐱",
    "😹",
    "🙈",
    "👻",
    "💀",
];

const PICKER_REACTION_EMOJIS: MessageEmoji[] = PICKER_REACTION_VALUES.map(
    (value) => createUnicodeReactionEmoji(value),
);

const MAX_CUSTOM_EMOJI_LENGTH = 16;

type GraphemeSegmenter = {
    segment: (value: string) => Iterable<{ segment: string }>;
};

export function MessageBubbleRN({
    authorName,
    currentUserID,
    isOwn,
    message,
    onDeleteMessageForEveryone,
    onDeleteMessageForMe,
    onEditMessage,
    onPressReplyTarget,
    onReplyMessage,
    onToggleReaction,
    replyTarget = null,
    showIdentity = true,
}: MessageBubbleRNProps) {
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [menuX, setMenuX] = React.useState(0);
    const [menuY, setMenuY] = React.useState(0);
    const [reactionPickerOpen, setReactionPickerOpen] = React.useState(false);
    const [customReactionValue, setCustomReactionValue] = React.useState("");
    const isDecryptFailure = !message.decrypted;
    const inviteID = React.useMemo(
        () => (isDecryptFailure ? null : extractInviteID(message.message)),
        [isDecryptFailure, message.message],
    );
    const markdownNodes = React.useMemo(
        () => (isDecryptFailure ? [] : parseMessageMarkdown(message.message)),
        [isDecryptFailure, message.message],
    );
    const embed = React.useMemo(
        () => (isDecryptFailure ? null : messageEmbed(message)),
        [isDecryptFailure, message],
    );
    const embedConsumesMessage = React.useMemo(
        () => Boolean(embed?.blocks?.some(usesMessageMarkdownSource)),
        [embed],
    );
    const replyTargetAuthorName = replyTarget?.authorName;
    const replyTargetMessage = replyTarget?.message;
    const replyReference = React.useMemo(
        () =>
            replyTargetMessage
                ? buildMessageReplyReference(
                      replyTargetMessage,
                      replyTargetAuthorName,
                  )
                : messageReply(message),
        [message, replyTargetAuthorName, replyTargetMessage],
    );
    const shouldRenderMessage =
        !embed || (embed.display !== "replace" && !embedConsumesMessage);
    const reactions = React.useMemo(() => messageReactions(message), [message]);

    const menuActions = React.useMemo(
        () => [
            ...(!isDecryptFailure && onReplyMessage
                ? [
                      {
                          id: "reply",
                          label: "Reply",
                          onPress: () => {
                              onReplyMessage(message);
                          },
                          tone: "default" as const,
                      },
                  ]
                : []),
            ...(!isDecryptFailure
                ? [
                      {
                          id: "copy",
                          label: "Copy text",
                          onPress: () => {
                              // eslint-disable-next-line @typescript-eslint/no-deprecated -- RN Clipboard is the supported API on bare app
                              Clipboard.setString(message.message);
                          },
                          tone: "default" as const,
                      },
                  ]
                : []),
            ...(isOwn && onEditMessage && !isDecryptFailure
                ? [
                      {
                          id: "edit",
                          label: "Edit message",
                          onPress: () => {
                              onEditMessage(message);
                          },
                          tone: "default" as const,
                      },
                  ]
                : []),
            ...(onDeleteMessageForMe
                ? [
                      {
                          id: "delete-for-me",
                          label: "Delete for me",
                          onPress: () => {
                              onDeleteMessageForMe(message);
                          },
                          tone: "destructive" as const,
                      },
                  ]
                : []),
            ...(isOwn && onDeleteMessageForEveryone
                ? [
                      {
                          id: "delete-for-everyone",
                          label: "Delete for everyone",
                          onPress: () => {
                              onDeleteMessageForEveryone(message);
                          },
                          tone: "destructive" as const,
                      },
                  ]
                : []),
        ],
        [
            isDecryptFailure,
            isOwn,
            message,
            onDeleteMessageForEveryone,
            onDeleteMessageForMe,
            onEditMessage,
            onReplyMessage,
        ],
    );

    const openContextMenuAt = (x: number, y: number) => {
        haptic("slotIn");
        setMenuX(x);
        setMenuY(y);
        setReactionPickerOpen(false);
        setCustomReactionValue("");
        setMenuOpen(true);
    };

    const closeContextMenu = () => {
        setMenuOpen(false);
        setReactionPickerOpen(false);
        setCustomReactionValue("");
    };

    const toggleReactionFromMenu = (emoji: MessageEmoji) => {
        haptic("selection");
        closeContextMenu();
        onToggleReaction?.(message, emoji);
    };

    const customReaction = emojiFromInput(customReactionValue);

    const handlePressIn = (event: GestureResponderEvent) => {
        const maybeMouseEvent = event.nativeEvent as { button?: number };
        if (maybeMouseEvent.button === 2) {
            openContextMenuAt(event.nativeEvent.pageX, event.nativeEvent.pageY);
        }
    };

    const estimatedMenuHeight =
        menuActions.length * 44 +
        12 +
        (onToggleReaction ? (reactionPickerOpen ? 338 : 48) : 0);
    const menuWidth = Math.min(
        windowWidth - 16,
        reactionPickerOpen ? 316 : 238,
    );
    const maxLeft = Math.max(8, windowWidth - menuWidth - 8);
    const maxTop = Math.max(8, windowHeight - estimatedMenuHeight - 8);
    const clampedLeft = clamp(menuX, 8, maxLeft);
    const clampedTop = clamp(menuY, 8, maxTop);

    const renderContextMenu = () => (
        <Modal
            animationType="none"
            onRequestClose={() => closeContextMenu()}
            transparent
            visible={menuOpen}
        >
            <Pressable
                onPress={() => {
                    closeContextMenu();
                }}
                style={styles.menuBackdrop}
            >
                <View
                    style={[
                        styles.menuCard,
                        {
                            left: clampedLeft,
                            maxHeight: windowHeight - 16,
                            top: clampedTop,
                            width: menuWidth,
                        },
                    ]}
                >
                    {onToggleReaction ? (
                        <>
                            <View style={styles.menuReactionRow}>
                                {QUICK_REACTION_EMOJIS.map((emoji) => (
                                    <Pressable
                                        accessibilityLabel={`React ${emojiReactionLabel(
                                            emoji,
                                        )}`}
                                        accessibilityRole="button"
                                        key={emojiReactionLabel(emoji)}
                                        onPress={() => {
                                            toggleReactionFromMenu(emoji);
                                        }}
                                        style={({ pressed }) => [
                                            styles.menuReactionButton,
                                            pressed && styles.menuItemPressed,
                                        ]}
                                    >
                                        <Text style={styles.menuReactionEmoji}>
                                            {emojiReactionLabel(emoji)}
                                        </Text>
                                    </Pressable>
                                ))}
                                <Pressable
                                    accessibilityLabel="More reactions"
                                    accessibilityRole="button"
                                    onPress={() => {
                                        haptic("selection");
                                        setReactionPickerOpen((open) => !open);
                                    }}
                                    style={({ pressed }) => [
                                        styles.menuReactionButton,
                                        reactionPickerOpen &&
                                            styles.menuReactionButtonActive,
                                        pressed && styles.menuItemPressed,
                                    ]}
                                >
                                    <Ionicons
                                        color="#E8EBF3"
                                        name="happy-outline"
                                        size={20}
                                    />
                                </Pressable>
                            </View>
                            {reactionPickerOpen ? (
                                <View style={styles.reactionPicker}>
                                    <View style={styles.reactionPickerInputRow}>
                                        <TextInput
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            maxLength={MAX_CUSTOM_EMOJI_LENGTH}
                                            onChangeText={
                                                setCustomReactionValue
                                            }
                                            placeholder="Emoji"
                                            placeholderTextColor={colors.muted}
                                            returnKeyType="done"
                                            style={styles.reactionPickerInput}
                                            value={customReactionValue}
                                        />
                                        <Pressable
                                            accessibilityLabel="React with typed emoji"
                                            accessibilityRole="button"
                                            disabled={!customReaction}
                                            onPress={() => {
                                                if (customReaction) {
                                                    toggleReactionFromMenu(
                                                        customReaction,
                                                    );
                                                }
                                            }}
                                            style={({ pressed }) => [
                                                styles.reactionPickerSubmit,
                                                !customReaction &&
                                                    styles.reactionPickerSubmitDisabled,
                                                pressed &&
                                                    styles.menuItemPressed,
                                            ]}
                                        >
                                            <Ionicons
                                                color={
                                                    customReaction
                                                        ? "#E8EBF3"
                                                        : colors.muted
                                                }
                                                name="checkmark"
                                                size={18}
                                            />
                                        </Pressable>
                                    </View>
                                    <ScrollView
                                        keyboardShouldPersistTaps="handled"
                                        showsVerticalScrollIndicator={false}
                                        style={styles.reactionPickerScroll}
                                    >
                                        <View style={styles.reactionPickerGrid}>
                                            {PICKER_REACTION_EMOJIS.map(
                                                (emoji, index) => (
                                                    <Pressable
                                                        accessibilityLabel={`React ${emojiReactionLabel(
                                                            emoji,
                                                        )}`}
                                                        accessibilityRole="button"
                                                        key={pickerEmojiKey(
                                                            emoji,
                                                            index,
                                                        )}
                                                        onPress={() => {
                                                            toggleReactionFromMenu(
                                                                emoji,
                                                            );
                                                        }}
                                                        style={({
                                                            pressed,
                                                        }) => [
                                                            styles.reactionPickerButton,
                                                            pressed &&
                                                                styles.menuItemPressed,
                                                        ]}
                                                    >
                                                        <Text
                                                            style={
                                                                styles.reactionPickerEmoji
                                                            }
                                                        >
                                                            {emojiReactionLabel(
                                                                emoji,
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                ),
                                            )}
                                        </View>
                                    </ScrollView>
                                </View>
                            ) : null}
                        </>
                    ) : null}
                    {menuActions.map((action, index) => (
                        <Pressable
                            key={action.id}
                            onPress={() => {
                                closeContextMenu();
                                action.onPress();
                            }}
                            style={({ pressed }) => [
                                styles.menuItem,
                                index > 0 && styles.menuItemDivider,
                                pressed && styles.menuItemPressed,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.menuText,
                                    action.tone === "destructive" &&
                                        styles.menuTextDestructive,
                                ]}
                            >
                                {action.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </Pressable>
        </Modal>
    );

    if (message.group === "__system__") {
        return (
            <>
                {renderContextMenu()}
                <Pressable
                    onLongPress={(event) => {
                        openContextMenuAt(
                            event.nativeEvent.pageX,
                            event.nativeEvent.pageY,
                        );
                    }}
                    onPressIn={handlePressIn}
                >
                    <View style={styles.systemContainer}>
                        <Text style={styles.systemText}>{message.message}</Text>
                    </View>
                </Pressable>
            </>
        );
    }

    return (
        <>
            {renderContextMenu()}
            <Pressable
                onLongPress={(event) => {
                    openContextMenuAt(
                        event.nativeEvent.pageX,
                        event.nativeEvent.pageY,
                    );
                }}
                onPressIn={handlePressIn}
            >
                <View
                    style={[
                        styles.container,
                        !showIdentity && styles.containerGrouped,
                    ]}
                >
                    {replyReference ? (
                        <View style={styles.replyReferenceRow}>
                            <View style={styles.avatarSpacer} />
                            <ReplyReferencePreview
                                onPress={
                                    onPressReplyTarget
                                        ? () => {
                                              onPressReplyTarget(
                                                  replyReference.targetMailID,
                                              );
                                          }
                                        : undefined
                                }
                                reply={replyReference}
                            />
                        </View>
                    ) : null}

                    <View style={styles.messageRow}>
                        {showIdentity ? (
                            <Avatar
                                displayName={authorName}
                                size={36}
                                userID={message.authorID}
                            />
                        ) : (
                            <View style={styles.avatarSpacer} />
                        )}

                        <View style={styles.content}>
                            {showIdentity && (
                                <View style={styles.meta}>
                                    <Text style={styles.author}>
                                        {authorName}
                                    </Text>
                                    <Text style={styles.timestamp}>
                                        {formatTime(message.timestamp)}
                                    </Text>
                                </View>
                            )}
                            {isDecryptFailure ? (
                                <DecryptFailureBlock mailID={message.mailID} />
                            ) : (
                                <>
                                    {embed ? (
                                        <MessageEmbedCard
                                            embed={embed}
                                            messageText={message.message}
                                        />
                                    ) : null}
                                    {shouldRenderMessage ? (
                                        <MarkdownMessage
                                            grouped={!showIdentity}
                                            nodes={markdownNodes}
                                        />
                                    ) : null}
                                    {inviteID ? (
                                        <InvitePreviewCard
                                            inviteID={inviteID}
                                            isOwn={isOwn}
                                        />
                                    ) : null}
                                    {!inviteID &&
                                    !embed?.suppressLinkPreview ? (
                                        <LinkPreviewCard
                                            content={message.message}
                                        />
                                    ) : null}
                                </>
                            )}
                            {!isDecryptFailure && reactions.length > 0 ? (
                                <ReactionRow
                                    currentUserID={currentUserID}
                                    onToggle={
                                        onToggleReaction
                                            ? (emoji) => {
                                                  onToggleReaction(
                                                      message,
                                                      emoji,
                                                  );
                                              }
                                            : undefined
                                    }
                                    reactions={reactions}
                                />
                            ) : null}
                        </View>
                    </View>
                </View>
            </Pressable>
        </>
    );
}

function AttachmentPreview({
    attachment,
    image,
}: {
    attachment: EncryptedFileAttachment;
    image: boolean;
}) {
    const shouldRenderImage = image || isImageType(attachment.contentType);
    const [error, setError] = React.useState("");
    const [imageUri, setImageUri] = React.useState<null | string>(null);
    const [imagePreviewOpen, setImagePreviewOpen] = React.useState(false);
    const [opening, setOpening] = React.useState(false);
    const [previewLoading, setPreviewLoading] = React.useState(false);

    React.useEffect(() => {
        if (!shouldRenderImage) {
            setImageUri(null);
            setPreviewLoading(false);
            setError("");
            return;
        }

        let cancelled = false;
        setImageUri(null);
        setPreviewLoading(true);
        setError("");
        void fetchAttachmentData(attachment)
            .then((data) => {
                if (cancelled) return;
                setImageUri(
                    `data:${attachment.contentType};base64,${bytesToBase64(
                        data,
                    )}`,
                );
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(
                    err instanceof Error ? err.message : "Could not load file",
                );
            })
            .finally(() => {
                if (!cancelled) {
                    setPreviewLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [attachment, shouldRenderImage]);

    const openAttachment = React.useCallback(async () => {
        if (opening) return;
        setOpening(true);
        setError("");
        try {
            const data = await fetchAttachmentData(attachment);
            const uri = await writeAttachmentToCache(attachment, data);
            const available = await Sharing.isAvailableAsync();
            if (!available) {
                Alert.alert("Downloaded", attachment.fileName);
                return;
            }
            await Sharing.shareAsync(uri, {
                dialogTitle: attachment.fileName,
                mimeType: attachment.contentType,
            });
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Could not open file";
            setError(message);
            Alert.alert("Could not open file", message);
        } finally {
            setOpening(false);
        }
    }, [attachment, opening]);

    const openImagePreview = React.useCallback(() => {
        if (imageUri) {
            haptic("selection");
            setImagePreviewOpen(true);
            return;
        }
        void openAttachment();
    }, [imageUri, openAttachment]);
    const imageAttachmentLabel = imageUri
        ? `Open image preview for ${attachment.fileName}`
        : `Open attachment for ${attachment.fileName}`;

    if (isAudioType(attachment.contentType)) {
        return (
            <AudioAttachment
                attachment={attachment}
                onShare={openAttachment}
                sharing={opening}
            />
        );
    }

    if (isVideoType(attachment.contentType)) {
        return (
            <VideoAttachment
                attachment={attachment}
                onShare={openAttachment}
                sharing={opening}
            />
        );
    }

    if (shouldRenderImage) {
        return (
            <>
                <Pressable
                    accessibilityLabel={imageAttachmentLabel}
                    accessibilityRole="imagebutton"
                    onPress={openImagePreview}
                    style={({ pressed }) => [
                        styles.imageAttachment,
                        pressed && styles.attachmentPressed,
                    ]}
                >
                    {previewLoading ? (
                        <View style={styles.imageLoading}>
                            <ActivityIndicator
                                color={colors.textSecondary}
                                size="small"
                            />
                        </View>
                    ) : imageUri ? (
                        <Image
                            resizeMode="cover"
                            source={{ uri: imageUri }}
                            style={styles.imageAttachmentMedia}
                        />
                    ) : (
                        <View style={styles.imageLoading}>
                            <Ionicons
                                color={colors.muted}
                                name="image-outline"
                                size={24}
                            />
                            <Text
                                numberOfLines={2}
                                style={styles.attachmentError}
                            >
                                {error || "Image unavailable"}
                            </Text>
                        </View>
                    )}
                    <View style={styles.attachmentCaption}>
                        <Text numberOfLines={1} style={styles.attachmentName}>
                            {attachment.fileName}
                        </Text>
                        <Text style={styles.attachmentSize}>
                            {formatFileSize(attachment.fileSize)}
                        </Text>
                    </View>
                </Pressable>
                <ImagePreviewModal
                    fileName={attachment.fileName}
                    fileSizeLabel={formatFileSize(attachment.fileSize)}
                    imageUri={imageUri}
                    onClose={() => {
                        setImagePreviewOpen(false);
                    }}
                    onShare={() => {
                        void openAttachment();
                    }}
                    sharing={opening}
                    visible={imagePreviewOpen}
                />
            </>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            onPress={() => void openAttachment()}
            style={({ pressed }) => [
                styles.fileAttachment,
                pressed && styles.attachmentPressed,
            ]}
        >
            <View style={styles.fileAttachmentIcon}>
                {opening ? (
                    <ActivityIndicator
                        color={colors.textSecondary}
                        size="small"
                    />
                ) : (
                    <Ionicons
                        color={colors.textSecondary}
                        name="document-text-outline"
                        size={20}
                    />
                )}
            </View>
            <View style={styles.fileAttachmentMeta}>
                <Text numberOfLines={1} style={styles.attachmentName}>
                    {attachment.fileName}
                </Text>
                <Text style={styles.attachmentSize}>
                    {formatFileSize(attachment.fileSize)}
                </Text>
                {error ? (
                    <Text numberOfLines={1} style={styles.attachmentError}>
                        {error}
                    </Text>
                ) : null}
            </View>
            <Ionicons color={colors.muted} name="download-outline" size={18} />
        </Pressable>
    );
}

function AudioAttachment({
    attachment,
    onShare,
    sharing,
}: {
    attachment: EncryptedFileAttachment;
    onShare: () => Promise<void>;
    sharing: boolean;
}) {
    const accent = useAccentColors();
    const player = useAudioPlayer(null, { updateInterval: 250 });
    const status = useAudioPlayerStatus(player);
    const mountedRef = React.useRef(true);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [mediaUri, setMediaUri] = React.useState<null | string>(null);

    React.useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadAudio = React.useCallback(async (): Promise<void> => {
        if (mediaUri) {
            return;
        }
        setLoading(true);
        setError("");
        try {
            const uri = await writeAttachmentDataToCache(attachment);
            if (!mountedRef.current) {
                return;
            }
            player.replace({ name: attachment.fileName, uri });
            setMediaUri(uri);
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Could not load audio";
            if (mountedRef.current) {
                setError(message);
            }
            throw new Error(message);
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [attachment, mediaUri, player]);

    const togglePlayback = React.useCallback(async () => {
        if (loading) return;
        try {
            if (status.playing) {
                await Promise.resolve(player.pause());
                return;
            }
            await loadAudio();
            if (!mountedRef.current) {
                return;
            }
            if (status.didJustFinish) {
                await player.seekTo(0);
            }
            player.play();
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Could not play audio";
            if (mountedRef.current) {
                setError(message);
            }
        }
    }, [loadAudio, loading, player, status.didJustFinish, status.playing]);

    const duration = Number.isFinite(status.duration) ? status.duration : 0;
    const currentTime = Number.isFinite(status.currentTime)
        ? status.currentTime
        : 0;
    const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
    const progressWidth = `${String(progress * 100)}%` as DimensionValue;
    const playIcon = status.playing ? "pause" : "play";
    const loadingLabel = mediaUri ? "Buffering audio" : "Loading audio";

    return (
        <View style={styles.audioAttachment}>
            <View style={styles.mediaHeader}>
                <Pressable
                    accessibilityLabel={
                        status.playing
                            ? `Pause ${attachment.fileName}`
                            : `Play ${attachment.fileName}`
                    }
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => {
                        void togglePlayback();
                    }}
                    style={({ pressed }) => [
                        styles.mediaPlayButton,
                        pressed && styles.attachmentPressed,
                    ]}
                >
                    {loading || status.isBuffering ? (
                        <ActivityIndicator
                            color={colors.textSecondary}
                            size="small"
                        />
                    ) : (
                        <Ionicons
                            color={colors.textSecondary}
                            name={playIcon}
                            size={20}
                        />
                    )}
                </Pressable>
                <View style={styles.fileAttachmentMeta}>
                    <Text numberOfLines={1} style={styles.attachmentName}>
                        {attachment.fileName}
                    </Text>
                    <Text style={styles.attachmentSize}>
                        {loading || status.isBuffering
                            ? loadingLabel
                            : formatFileSize(attachment.fileSize)}
                    </Text>
                </View>
                <Pressable
                    accessibilityLabel={`Share ${attachment.fileName}`}
                    accessibilityRole="button"
                    disabled={sharing}
                    onPress={() => {
                        void onShare();
                    }}
                    style={({ pressed }) => [
                        styles.mediaIconButton,
                        pressed && styles.attachmentPressed,
                    ]}
                >
                    {sharing ? (
                        <ActivityIndicator color={colors.muted} size="small" />
                    ) : (
                        <Ionicons
                            color={colors.muted}
                            name="share-outline"
                            size={18}
                        />
                    )}
                </Pressable>
            </View>
            <View style={styles.mediaProgressTrack}>
                <View
                    style={[
                        styles.mediaProgressFill,
                        {
                            backgroundColor: accent.accent,
                            width: progressWidth,
                        },
                    ]}
                />
            </View>
            <View style={styles.mediaTimeRow}>
                <Text style={styles.attachmentSize}>
                    {formatMediaTime(currentTime)}
                </Text>
                <Text style={styles.attachmentSize}>
                    {duration > 0 ? formatMediaTime(duration) : "--:--"}
                </Text>
            </View>
            {error ? (
                <Text numberOfLines={2} style={styles.attachmentError}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function CodeBlock({
    code,
    language,
}: {
    code: string;
    language?: string | undefined;
}) {
    const segments = React.useMemo(
        () => highlightCode(code, language),
        [code, language],
    );

    return (
        <View style={styles.codeBlock}>
            {language ? (
                <Text style={styles.codeBlockLanguage}>{language}</Text>
            ) : null}
            <ScrollView
                contentContainerStyle={styles.codeBlockContent}
                horizontal
                showsHorizontalScrollIndicator={false}
            >
                <Text selectable style={styles.codeBlockText}>
                    {segments.map((segment, index) => (
                        <Text
                            key={`${segment.kind ?? "plain"}-${String(index)}`}
                            style={codeHighlightStyle(segment.kind)}
                        >
                            {segment.text}
                        </Text>
                    ))}
                </Text>
            </ScrollView>
        </View>
    );
}

function codeHighlightStyle(
    kind: CodeHighlightKind | undefined,
): null | TextStyle {
    switch (kind) {
        case "attribute":
            return styles.codeHighlightAttribute;
        case "builtIn":
            return styles.codeHighlightBuiltIn;
        case "comment":
            return styles.codeHighlightComment;
        case "keyword":
            return styles.codeHighlightKeyword;
        case "literal":
            return styles.codeHighlightLiteral;
        case "number":
            return styles.codeHighlightNumber;
        case "string":
            return styles.codeHighlightString;
        case "title":
            return styles.codeHighlightTitle;
        case undefined:
            return null;
    }
}

function DecryptFailureBlock({ mailID }: { mailID: string }) {
    return (
        <View accessibilityRole="alert" style={styles.decryptFailureBlock}>
            <View style={styles.decryptFailureIcon}>
                <Ionicons
                    color={colors.error}
                    name="alert-circle-outline"
                    size={18}
                />
            </View>
            <View style={styles.decryptFailureBody}>
                <Text style={styles.decryptFailureTitle}>
                    Message could not be decrypted
                </Text>
                <Text style={styles.decryptFailureText}>
                    This device received the notification, but could not open
                    the encrypted payload.
                </Text>
                <Text style={styles.decryptFailureMeta}>
                    Mail {mailID.slice(0, 8)}
                </Text>
            </View>
        </View>
    );
}

function embedBlockKey(block: MessageEmbedBlock, index: number): string {
    if ("attachment" in block) {
        return `${block.type}:${block.attachment.fileID}:${String(index)}`;
    }
    return `${block.type}:${String(index)}`;
}

function embedIconName(
    icon: string | undefined,
    kind: string,
): React.ComponentProps<typeof Ionicons>["name"] {
    const value = icon ?? kind;
    if (value.includes("audio") || value.includes("voice")) {
        return "mic-outline";
    }
    if (value.includes("bot") || value.includes("assistant")) {
        return "sparkles-outline";
    }
    if (value.includes("branch") || value.includes("git")) {
        return "git-branch-outline";
    }
    if (value.includes("issue")) {
        return "alert-circle-outline";
    }
    if (value.includes("pull")) {
        return "git-pull-request-outline";
    }
    if (value.includes("release")) {
        return "pricetag-outline";
    }
    if (value.includes("tool")) {
        return "hammer-outline";
    }
    return "information-circle-outline";
}

function embedToneStyle(tone: MessageEmbed["tone"]) {
    switch (tone) {
        case "danger":
            return styles.embedCardDanger;
        case "default":
        case "info":
        case undefined:
            return null;
        case "success":
            return styles.embedCardSuccess;
        case "warning":
            return styles.embedCardWarning;
    }
}

function emojiFromInput(value: string): MessageEmoji | null {
    const trimmed = value.trim();
    if (!isSingleEmojiGrapheme(trimmed)) {
        return null;
    }
    return createUnicodeReactionEmoji(trimmed);
}

async function fetchAttachmentData(
    attachment: EncryptedFileAttachment,
): Promise<Uint8Array> {
    const result = await vexService.downloadFileAttachment(attachment);
    if (!result.ok || !result.data) {
        throw new Error(result.error ?? "Could not download file");
    }
    return result.data;
}

function formatMediaTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainder = totalSeconds % 60;
    return `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

function inlineSegmentStyle(segment: MarkdownInlineSegment): null | TextStyle {
    switch (segment.type) {
        case "code":
            return styles.inlineCode;
        case "emphasis":
            return styles.inlineEmphasis;
        case "link":
            return styles.inlineLink;
        case "strong":
            return styles.inlineStrong;
        case "text":
            return null;
    }
}

function isAudioType(contentType: string): boolean {
    return contentType.toLowerCase().startsWith("audio/");
}

function isSingleEmojiGrapheme(value: string): boolean {
    if (!value || value.length > MAX_CUSTOM_EMOJI_LENGTH) {
        return false;
    }
    const segmenter = (
        Intl as typeof Intl & {
            Segmenter?: new (
                locale?: string,
                options?: { granularity: "grapheme" },
            ) => GraphemeSegmenter;
        }
    ).Segmenter;
    if (segmenter) {
        const segments = [
            ...new segmenter(undefined, { granularity: "grapheme" }).segment(
                value,
            ),
        ];
        if (segments.length !== 1 || segments[0]?.segment !== value) {
            return false;
        }
    } else if (Array.from(value).length !== 1) {
        return false;
    }
    return /\p{Extended_Pictographic}/u.test(value);
}

function isVideoType(contentType: string): boolean {
    return contentType.toLowerCase().startsWith("video/");
}

function MarkdownMessage({
    grouped,
    nodes,
}: {
    grouped: boolean;
    nodes: MessageMarkdownNode[];
}) {
    return (
        <View style={styles.markdownStack}>
            {nodes.map((node, index) => {
                if (node.type === "text") {
                    return (
                        <MarkdownText
                            grouped={grouped && index === 0}
                            key={`text-${String(index)}`}
                            segments={node.segments}
                        />
                    );
                }
                if (node.type === "codeBlock") {
                    return (
                        <CodeBlock
                            code={node.code}
                            key={`code-${String(index)}`}
                            language={node.language}
                        />
                    );
                }
                return (
                    <AttachmentPreview
                        attachment={node.attachment}
                        image={node.image}
                        key={`${node.attachment.fileID}-${String(index)}`}
                    />
                );
            })}
        </View>
    );
}

function MarkdownText({
    grouped,
    segments,
}: {
    grouped: boolean;
    segments: MarkdownInlineSegment[];
}) {
    return (
        <Text style={[styles.text, grouped && styles.textGrouped]}>
            {segments.map((segment, index) => (
                <Text
                    key={`${segment.type}-${String(index)}`}
                    onPress={
                        segment.type === "link"
                            ? () => {
                                  openExternalUrl(segment.url);
                              }
                            : undefined
                    }
                    style={inlineSegmentStyle(segment)}
                >
                    {segment.type === "code"
                        ? segment.text
                        : applyEmoji(segment.text)}
                </Text>
            ))}
        </Text>
    );
}

function MessageEmbedBlockView({
    block,
    messageText,
}: {
    block: MessageEmbedBlock;
    messageText: string;
}) {
    switch (block.type) {
        case "code":
            return <CodeBlock code={block.code} language={block.language} />;
        case "divider":
            return <View style={styles.embedDivider} />;
        case "file":
            return (
                <AttachmentPreview
                    attachment={block.attachment}
                    image={false}
                />
            );
        case "gallery":
            return (
                <View style={styles.embedGallery}>
                    {block.items.map((item, index) => (
                        <MessageEmbedMedia
                            item={item}
                            key={`${item.attachment.fileID}-${String(index)}`}
                        />
                    ))}
                </View>
            );
        case "markdown":
            return (
                <MarkdownMessage
                    grouped={false}
                    nodes={parseMessageMarkdown(
                        block.source === "message"
                            ? messageText
                            : (block.text ?? ""),
                    )}
                />
            );
        case "media":
            return <MessageEmbedMedia item={block} />;
    }
}

function MessageEmbedCard({
    embed,
    messageText,
}: {
    embed: MessageEmbed;
    messageText: string;
}) {
    return (
        <View style={[styles.embedCard, embedToneStyle(embed.tone)]}>
            <View style={styles.embedHeader}>
                <View style={styles.embedIcon}>
                    <MessageEmbedIcon embed={embed} />
                </View>
                <View style={styles.embedHeaderText}>
                    <Text numberOfLines={2} style={styles.embedTitle}>
                        {embed.title}
                    </Text>
                    {embed.subtitle ? (
                        <Text numberOfLines={2} style={styles.embedSubtitle}>
                            {embed.subtitle}
                        </Text>
                    ) : null}
                </View>
            </View>
            {embed.fields?.length ? (
                <View style={styles.embedFields}>
                    {embed.fields.map((field, index) => (
                        <View
                            key={`${field.label}-${String(index)}`}
                            style={[
                                styles.embedField,
                                field.short && styles.embedFieldShort,
                            ]}
                        >
                            <Text style={styles.embedFieldLabel}>
                                {field.label}
                            </Text>
                            <Text
                                numberOfLines={field.short ? 2 : undefined}
                                style={[
                                    styles.embedFieldValue,
                                    field.mono && styles.embedFieldValueMono,
                                ]}
                            >
                                {field.value}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}
            {embed.blocks?.length ? (
                <View style={styles.embedBlocks}>
                    {embed.blocks.map((block, index) => (
                        <MessageEmbedBlockView
                            block={block}
                            key={embedBlockKey(block, index)}
                            messageText={messageText}
                        />
                    ))}
                </View>
            ) : null}
            {embed.actions?.length ? (
                <View style={styles.embedActions}>
                    {embed.actions.map((action, index) => (
                        <Pressable
                            accessibilityRole="link"
                            key={`${action.url}-${String(index)}`}
                            onPress={() => {
                                openExternalUrl(action.url);
                            }}
                            style={({ pressed }) => [
                                styles.embedAction,
                                pressed && styles.attachmentPressed,
                            ]}
                        >
                            <Text style={styles.embedActionText}>
                                {action.label}
                            </Text>
                            <Ionicons
                                color={colors.muted}
                                name="open-outline"
                                size={14}
                            />
                        </Pressable>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function MessageEmbedIcon({ embed }: { embed: MessageEmbed }) {
    const attachment = embed.iconAttachment;
    const [iconImageFailed, setIconImageFailed] = React.useState(false);
    const [iconUri, setIconUri] = React.useState<null | string>(null);

    React.useEffect(() => {
        setIconImageFailed(false);
        if (!attachment || !isImageType(attachment.contentType)) {
            setIconUri(null);
            return;
        }

        let cancelled = false;
        setIconUri(null);
        void fetchAttachmentData(attachment)
            .then((data) => {
                if (cancelled) return;
                setIconUri(
                    `data:${attachment.contentType};base64,${bytesToBase64(
                        data,
                    )}`,
                );
            })
            .catch(() => {
                if (!cancelled) setIconUri(null);
            });

        return () => {
            cancelled = true;
        };
    }, [attachment]);

    if (iconUri && !iconImageFailed) {
        return (
            <Image
                accessibilityIgnoresInvertColors
                onError={() => {
                    setIconImageFailed(true);
                }}
                source={{ uri: iconUri }}
                style={styles.embedIconImage}
            />
        );
    }

    return (
        <Ionicons
            color={colors.textSecondary}
            name={embedIconName(embed.icon, embed.kind)}
            size={16}
        />
    );
}

function MessageEmbedMedia({ item }: { item: MessageEmbedMediaItem }) {
    const image =
        item.mediaType === "image" ||
        item.mediaType === "svg" ||
        isImageType(item.attachment.contentType);
    return (
        <View style={styles.embedMedia}>
            {item.title ? (
                <Text numberOfLines={1} style={styles.embedMediaTitle}>
                    {item.title}
                </Text>
            ) : null}
            <AttachmentPreview attachment={item.attachment} image={image} />
            {item.caption ? (
                <Text style={styles.embedMediaCaption}>{item.caption}</Text>
            ) : null}
        </View>
    );
}

function pickerEmojiKey(emoji: MessageEmoji, index: number): string {
    return `${emojiReactionKey(emoji)}:${String(index)}`;
}

function ReactionEmoji({ emoji }: { emoji: MessageEmoji }) {
    if (emoji.kind === "custom" && emoji.imageUrl) {
        return (
            <Image
                accessibilityLabel={emojiReactionLabel(emoji)}
                source={{ uri: emoji.imageUrl }}
                style={styles.reactionImage}
            />
        );
    }

    return (
        <Text style={styles.reactionEmoji}>{emojiReactionLabel(emoji)}</Text>
    );
}

function ReactionRow({
    currentUserID,
    onToggle,
    reactions,
}: {
    currentUserID?: string | undefined;
    onToggle?: ((emoji: MessageEmoji) => void) | undefined;
    reactions: MessageReaction[];
}) {
    const accent = useAccentColors();
    return (
        <View style={styles.reactionRow}>
            {reactions.map((reaction) => {
                const selected = currentUserID
                    ? reaction.userIDs.includes(currentUserID)
                    : false;
                return (
                    <Pressable
                        accessibilityLabel={`${emojiReactionLabel(
                            reaction.emoji,
                        )} ${String(reaction.userIDs.length)}`}
                        accessibilityRole="button"
                        disabled={!onToggle}
                        key={emojiReactionKey(reaction.emoji)}
                        onPress={
                            onToggle
                                ? () => {
                                      onToggle(reaction.emoji);
                                  }
                                : undefined
                        }
                        style={({ pressed }) => [
                            styles.reactionPill,
                            selected && {
                                backgroundColor: accent.accentSoft,
                                borderColor: accent.accentBorder,
                            },
                            pressed && styles.attachmentPressed,
                        ]}
                    >
                        <ReactionEmoji emoji={reaction.emoji} />
                        <Text style={styles.reactionCount}>
                            {reaction.userIDs.length}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

function ReplyAttachmentThumbnail({
    attachment,
}: {
    attachment: EncryptedFileAttachment;
}) {
    const shouldRenderImage = isImageType(attachment.contentType);
    const [imageUri, setImageUri] = React.useState<null | string>(null);

    React.useEffect(() => {
        if (!shouldRenderImage) {
            setImageUri(null);
            return;
        }
        let cancelled = false;
        setImageUri(null);
        void fetchAttachmentData(attachment)
            .then((data) => {
                if (cancelled) return;
                setImageUri(
                    `data:${attachment.contentType};base64,${bytesToBase64(
                        data,
                    )}`,
                );
            })
            .catch(() => {
                if (!cancelled) setImageUri(null);
            });
        return () => {
            cancelled = true;
        };
    }, [attachment, shouldRenderImage]);

    if (imageUri) {
        return (
            <Image
                accessibilityIgnoresInvertColors
                source={{ uri: imageUri }}
                style={styles.replyAttachmentImage}
            />
        );
    }

    return (
        <View style={styles.replyAttachmentIcon}>
            <Ionicons
                color={colors.textSecondary}
                name={shouldRenderImage ? "image-outline" : "document-outline"}
                size={16}
            />
        </View>
    );
}

function ReplyReferencePreview({
    onPress,
    reply,
}: {
    onPress?: (() => void) | undefined;
    reply: MessageReplyReference;
}) {
    const author =
        reply.targetAuthorName ??
        (reply.targetAuthorID ? reply.targetAuthorID.slice(0, 8) : "Message");
    const preview =
        reply.targetPreview ??
        reply.targetAttachment?.fileName ??
        "Original message";
    const targetAuthorID = reply.targetAuthorID;

    return (
        <View style={styles.replyReference}>
            <View style={styles.replyConnector}>
                <View style={styles.replyConnectorCurve} />
            </View>
            <Pressable
                accessibilityRole={onPress ? "button" : undefined}
                disabled={!onPress}
                onPress={onPress}
                style={({ pressed }) => [
                    styles.replyPreview,
                    pressed && styles.attachmentPressed,
                ]}
            >
                {targetAuthorID ? (
                    <Avatar
                        displayName={author}
                        size={22}
                        userID={targetAuthorID}
                    />
                ) : (
                    <View style={styles.replyAvatarFallback}>
                        <Ionicons
                            color={colors.textSecondary}
                            name="arrow-undo-outline"
                            size={14}
                        />
                    </View>
                )}
                <View style={styles.replyPreviewBody}>
                    <Text numberOfLines={1} style={styles.replyAuthor}>
                        {author}
                    </Text>
                    <Text numberOfLines={1} style={styles.replyPreviewText}>
                        {preview}
                    </Text>
                </View>
                {reply.targetAttachment ? (
                    <ReplyAttachmentThumbnail
                        attachment={reply.targetAttachment}
                    />
                ) : null}
            </Pressable>
        </View>
    );
}

function usesMessageMarkdownSource(block: MessageEmbedBlock): boolean {
    if (block.type !== "markdown") return false;
    return block.source === "message";
}

function VideoAttachment({
    attachment,
    onShare,
    sharing,
}: {
    attachment: EncryptedFileAttachment;
    onShare: () => Promise<void>;
    sharing: boolean;
}) {
    const player = useVideoPlayer(null, (videoPlayer) => {
        videoPlayer.showNowPlayingNotification = false;
        videoPlayer.staysActiveInBackground = false;
    });
    const mountedRef = React.useRef(true);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [mediaUri, setMediaUri] = React.useState<null | string>(null);

    React.useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadVideo = React.useCallback(async (): Promise<void> => {
        if (mediaUri) {
            player.play();
            return;
        }
        setLoading(true);
        setError("");
        try {
            const uri = await writeAttachmentDataToCache(attachment);
            if (!mountedRef.current) {
                return;
            }
            await player.replaceAsync({
                metadata: { title: attachment.fileName },
                uri,
            });
            if (!mountedRef.current) {
                return;
            }
            setMediaUri(uri);
            player.play();
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Could not load video";
            if (mountedRef.current) {
                setError(message);
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [attachment, mediaUri, player]);

    if (!mediaUri) {
        return (
            <Pressable
                accessibilityLabel={`Play video ${attachment.fileName}`}
                accessibilityRole="button"
                disabled={loading}
                onPress={() => {
                    void loadVideo();
                }}
                style={({ pressed }) => [
                    styles.fileAttachment,
                    pressed && styles.attachmentPressed,
                ]}
            >
                <View style={styles.fileAttachmentIcon}>
                    {loading ? (
                        <ActivityIndicator
                            color={colors.textSecondary}
                            size="small"
                        />
                    ) : (
                        <Ionicons
                            color={colors.textSecondary}
                            name="play"
                            size={20}
                        />
                    )}
                </View>
                <View style={styles.fileAttachmentMeta}>
                    <Text numberOfLines={1} style={styles.attachmentName}>
                        {attachment.fileName}
                    </Text>
                    <Text style={styles.attachmentSize}>
                        {loading
                            ? "Loading video"
                            : formatFileSize(attachment.fileSize)}
                    </Text>
                    {error ? (
                        <Text numberOfLines={1} style={styles.attachmentError}>
                            {error}
                        </Text>
                    ) : null}
                </View>
                <Ionicons
                    color={colors.muted}
                    name="videocam-outline"
                    size={18}
                />
            </Pressable>
        );
    }

    return (
        <View style={styles.videoAttachment}>
            <VideoView
                contentFit="contain"
                fullscreenOptions={{ enable: true }}
                nativeControls
                player={player}
                style={styles.videoAttachmentMedia}
            />
            <View style={styles.mediaFooter}>
                <View style={styles.fileAttachmentMeta}>
                    <Text numberOfLines={1} style={styles.attachmentName}>
                        {attachment.fileName}
                    </Text>
                    <Text style={styles.attachmentSize}>
                        {formatFileSize(attachment.fileSize)}
                    </Text>
                </View>
                <Pressable
                    accessibilityLabel={`Share ${attachment.fileName}`}
                    accessibilityRole="button"
                    disabled={sharing}
                    onPress={() => {
                        void onShare();
                    }}
                    style={({ pressed }) => [
                        styles.mediaIconButton,
                        pressed && styles.attachmentPressed,
                    ]}
                >
                    {sharing ? (
                        <ActivityIndicator color={colors.muted} size="small" />
                    ) : (
                        <Ionicons
                            color={colors.muted}
                            name="share-outline"
                            size={18}
                        />
                    )}
                </Pressable>
            </View>
            {error ? (
                <Text numberOfLines={2} style={styles.attachmentError}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
}

async function writeAttachmentDataToCache(
    attachment: EncryptedFileAttachment,
): Promise<string> {
    const data = await fetchAttachmentData(attachment);
    return writeAttachmentToCache(attachment, data);
}

const styles = StyleSheet.create({
    attachmentCaption: {
        backgroundColor: "rgba(0,0,0,0.62)",
        bottom: 0,
        gap: 1,
        left: 0,
        paddingHorizontal: 10,
        paddingVertical: 7,
        position: "absolute",
        right: 0,
    },
    attachmentError: {
        ...typography.body,
        color: colors.error,
        fontSize: 11,
    },
    attachmentName: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: "600",
    },
    attachmentPressed: {
        opacity: 0.82,
    },
    attachmentSize: {
        ...typography.body,
        color: colors.muted,
        fontSize: 11,
    },
    audioAttachment: {
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 10,
        borderWidth: 1,
        gap: 8,
        marginTop: 6,
        maxWidth: 360,
        padding: 10,
    },
    author: {
        ...typography.body,
        color: colors.textSecondary,
        fontFamily: fontFamilies.heading,
        fontSize: 13,
        fontWeight: "600",
        lineHeight: 18,
    },
    avatarSpacer: {
        width: 36,
    },
    codeBlock: {
        backgroundColor: colors.rail,
        borderColor: colors.borderSubtle,
        borderRadius: 10,
        borderWidth: 1,
        marginTop: 6,
        maxWidth: 360,
        overflow: "hidden",
    },
    codeBlockContent: {
        paddingHorizontal: 11,
        paddingVertical: 9,
    },
    codeBlockLanguage: {
        ...typography.body,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderBottomColor: "rgba(255,255,255,0.08)",
        borderBottomWidth: 1,
        color: colors.muted,
        fontFamily: fontFamilies.mono,
        fontSize: 11,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    codeBlockText: {
        color: "#c9d1d9",
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        lineHeight: 18,
    },
    codeHighlightAttribute: {
        color: "#79c0ff",
    },
    codeHighlightBuiltIn: {
        color: "#ffa657",
    },
    codeHighlightComment: {
        color: "#8b949e",
        fontStyle: "italic",
    },
    codeHighlightKeyword: {
        color: "#ff7b72",
    },
    codeHighlightLiteral: {
        color: "#79c0ff",
    },
    codeHighlightNumber: {
        color: "#a5d6ff",
    },
    codeHighlightString: {
        color: "#a5d6ff",
    },
    codeHighlightTitle: {
        color: "#d2a8ff",
    },
    container: {
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    containerGrouped: {
        paddingBottom: 1,
        paddingTop: 1,
    },
    content: {
        flex: 1,
    },
    decryptFailureBlock: {
        alignItems: "flex-start",
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
        borderLeftColor: colors.error,
        borderLeftWidth: 3,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        gap: 9,
        marginTop: 4,
        maxWidth: 390,
        padding: 10,
    },
    decryptFailureBody: {
        flex: 1,
        gap: 2,
        minWidth: 0,
    },
    decryptFailureIcon: {
        alignItems: "center",
        backgroundColor: colors.dangerBg,
        borderRadius: 7,
        height: 30,
        justifyContent: "center",
        width: 30,
    },
    decryptFailureMeta: {
        ...typography.body,
        color: colors.muted,
        fontFamily: fontFamilies.mono,
        fontSize: 11,
        marginTop: 2,
    },
    decryptFailureText: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    decryptFailureTitle: {
        ...typography.body,
        color: colors.dangerText,
        fontSize: 13,
        fontWeight: "700",
    },
    embedAction: {
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    embedActions: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 10,
    },
    embedActionText: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: "700",
    },
    embedBlocks: {
        gap: 8,
        marginTop: 10,
    },
    embedCard: {
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: colors.infoBorder,
        borderLeftColor: colors.info,
        borderLeftWidth: 3,
        borderRadius: 10,
        borderWidth: 1,
        marginTop: 4,
        maxWidth: 390,
        padding: 11,
    },
    embedCardDanger: {
        borderLeftColor: colors.error,
    },
    embedCardSuccess: {
        borderLeftColor: "#59D38C",
    },
    embedCardWarning: {
        borderLeftColor: "#FFD166",
    },
    embedDivider: {
        backgroundColor: "rgba(255,255,255,0.1)",
        height: 1,
    },
    embedField: {
        flexBasis: "100%",
        gap: 2,
    },
    embedFieldLabel: {
        ...typography.body,
        color: colors.muted,
        fontFamily: fontFamilies.mono,
        fontSize: 10,
        letterSpacing: 1.1,
        textTransform: "uppercase",
    },
    embedFields: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 10,
    },
    embedFieldShort: {
        flexBasis: "47%",
        flexGrow: 1,
    },
    embedFieldValue: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 12,
    },
    embedFieldValueMono: {
        fontFamily: fontFamilies.mono,
    },
    embedGallery: {
        gap: 8,
    },
    embedHeader: {
        alignItems: "center",
        flexDirection: "row",
        gap: 9,
    },
    embedHeaderText: {
        flex: 1,
        minWidth: 0,
    },
    embedIcon: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 7,
        borderWidth: 1,
        height: 30,
        justifyContent: "center",
        width: 30,
    },
    embedIconImage: {
        borderRadius: 5,
        height: 22,
        width: 22,
    },
    embedMedia: {
        gap: 4,
    },
    embedMediaCaption: {
        ...typography.body,
        color: colors.muted,
        fontSize: 11,
    },
    embedMediaTitle: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: "700",
    },
    embedSubtitle: {
        ...typography.body,
        color: colors.muted,
        fontSize: 11,
    },
    embedTitle: {
        ...typography.body,
        color: colors.text,
        fontSize: 13,
        fontWeight: "700",
    },
    fileAttachment: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        marginTop: 6,
        maxWidth: 360,
        padding: 10,
    },
    fileAttachmentIcon: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 6,
        borderWidth: 1,
        height: 38,
        justifyContent: "center",
        width: 38,
    },
    fileAttachmentMeta: {
        flex: 1,
        minWidth: 0,
    },
    imageAttachment: {
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 12,
        borderWidth: 1,
        height: 220,
        marginTop: 6,
        maxWidth: 360,
        overflow: "hidden",
        width: "100%",
    },
    imageAttachmentMedia: {
        height: "100%",
        width: "100%",
    },
    imageLoading: {
        alignItems: "center",
        flex: 1,
        gap: 8,
        justifyContent: "center",
        padding: 16,
    },
    inlineCode: {
        backgroundColor: "rgba(255,255,255,0.08)",
        color: colors.textSecondary,
        fontFamily: fontFamilies.mono,
    },
    inlineEmphasis: {
        fontStyle: "italic",
    },
    inlineLink: {
        color: colors.info,
        textDecorationLine: "underline",
    },
    inlineStrong: {
        fontWeight: "700",
    },
    markdownStack: {
        gap: 0,
    },
    mediaFooter: {
        alignItems: "center",
        borderTopColor: "rgba(255,255,255,0.08)",
        borderTopWidth: 1,
        flexDirection: "row",
        gap: 10,
        padding: 10,
    },
    mediaHeader: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
    },
    mediaIconButton: {
        alignItems: "center",
        borderRadius: 6,
        height: 34,
        justifyContent: "center",
        width: 34,
    },
    mediaPlayButton: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 999,
        borderWidth: 1,
        height: 38,
        justifyContent: "center",
        width: 38,
    },
    mediaProgressFill: {
        borderRadius: 999,
        height: "100%",
    },
    mediaProgressTrack: {
        backgroundColor: "rgba(255,255,255,0.1)",
        borderRadius: 999,
        height: 4,
        overflow: "hidden",
    },
    mediaTimeRow: {
        flexDirection: "row",
        justifyContent: "space-between",
    },
    menuBackdrop: {
        ...StyleSheet.absoluteFill,
    },
    menuCard: {
        backgroundColor: colors.elevated,
        borderColor: colors.borderSubtle,
        borderRadius: 14,
        borderWidth: 1,
        elevation: 12,
        minWidth: 190,
        overflow: "hidden",
        position: "absolute",
        shadowColor: "#000",
        shadowOffset: { height: 10, width: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 22,
    },
    menuItem: {
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    menuItemDivider: {
        borderTopColor: "rgba(255,255,255,0.08)",
        borderTopWidth: 1,
    },
    menuItemPressed: {
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    menuReactionButton: {
        alignItems: "center",
        borderRadius: 8,
        height: 34,
        justifyContent: "center",
        width: 34,
    },
    menuReactionButtonActive: {
        backgroundColor: "rgba(255,255,255,0.1)",
    },
    menuReactionEmoji: {
        fontSize: 18,
        lineHeight: 24,
    },
    menuReactionRow: {
        borderBottomColor: "rgba(255,255,255,0.08)",
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 2,
        paddingHorizontal: 8,
        paddingVertical: 7,
    },
    menuText: {
        ...typography.body,
        color: "#E8EBF3",
        fontSize: 14,
    },
    menuTextDestructive: {
        color: "#FF7A7A",
    },
    messageRow: {
        flexDirection: "row",
        gap: 10,
    },
    meta: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        marginBottom: 1,
    },
    reactionCount: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 14,
    },
    reactionEmoji: {
        fontSize: 13,
        lineHeight: 16,
    },
    reactionImage: {
        borderRadius: 3,
        height: 16,
        width: 16,
    },
    reactionPicker: {
        borderBottomColor: "rgba(255,255,255,0.08)",
        borderBottomWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    reactionPickerButton: {
        alignItems: "center",
        borderRadius: 8,
        height: 34,
        justifyContent: "center",
        width: 34,
    },
    reactionPickerEmoji: {
        fontSize: 20,
        lineHeight: 26,
    },
    reactionPickerGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        paddingTop: 8,
    },
    reactionPickerInput: {
        ...typography.body,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 8,
        borderWidth: 1,
        color: "#E8EBF3",
        flex: 1,
        fontSize: 18,
        height: 36,
        paddingHorizontal: 10,
        paddingVertical: 0,
    },
    reactionPickerInputRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
    reactionPickerScroll: {
        maxHeight: 208,
    },
    reactionPickerSubmit: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
        borderRadius: 8,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    reactionPickerSubmitDisabled: {
        opacity: 0.45,
    },
    reactionPill: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: "row",
        gap: 4,
        minHeight: 24,
        paddingHorizontal: 10,
        paddingVertical: 3,
    },
    reactionRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 5,
    },
    replyAttachmentIcon: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.055)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 6,
        borderWidth: 1,
        height: 28,
        justifyContent: "center",
        width: 28,
    },
    replyAttachmentImage: {
        backgroundColor: colors.input,
        borderRadius: 6,
        height: 28,
        width: 28,
    },
    replyAuthor: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 17,
    },
    replyAvatarFallback: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.055)",
        borderRadius: 999,
        height: 22,
        justifyContent: "center",
        width: 22,
    },
    replyConnector: {
        alignItems: "flex-end",
        paddingTop: 10,
        width: 26,
    },
    replyConnectorCurve: {
        borderColor: "rgba(154,158,178,0.42)",
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderTopLeftRadius: 11,
        borderTopWidth: StyleSheet.hairlineWidth,
        height: 30,
        width: 21,
    },
    replyPreview: {
        alignItems: "center",
        flex: 1,
        flexDirection: "row",
        gap: 8,
        maxWidth: 420,
        minHeight: 38,
        paddingBottom: 2,
        paddingTop: 1,
    },
    replyPreviewBody: {
        flex: 1,
        minWidth: 0,
    },
    replyPreviewText: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17,
    },
    replyReference: {
        alignItems: "flex-start",
        flex: 1,
        flexDirection: "row",
    },
    replyReferenceRow: {
        flexDirection: "row",
        gap: 10,
        marginBottom: 2,
        marginTop: 0,
    },
    systemContainer: {
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    systemText: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        fontStyle: "italic",
    },
    text: {
        ...typography.body,
        color: colors.textSecondary,
    },
    textGrouped: {
        marginTop: 0,
    },
    timestamp: {
        ...typography.body,
        color: colors.muted,
        fontFamily: fontFamilies.mono,
        fontSize: 10,
        letterSpacing: 0.4,
        lineHeight: 14,
    },
    videoAttachment: {
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 12,
        borderWidth: 1,
        marginTop: 6,
        maxWidth: 360,
        overflow: "hidden",
        width: "100%",
    },
    videoAttachmentMedia: {
        backgroundColor: "#000",
        height: 220,
        width: "100%",
    },
});
