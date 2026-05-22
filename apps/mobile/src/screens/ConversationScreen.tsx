import type { PickedAttachment } from "../lib/attachments";
import type { AppScreenProps } from "../navigation/types";
import type { Message } from "@vex-chat/libvex";
import type { MessageEmoji } from "@vex-chat/store";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    View,
} from "react-native";

import {
    $messages,
    $user,
    formatFileAttachmentMarkdown,
    vexService,
} from "@vex-chat/store";

import { useStore } from "@nanostores/react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatHeader } from "../components/ChatHeader";
import { MessageBubbleRN } from "../components/MessageBubbleRN";
import { MessageInputBar } from "../components/MessageInputBar";
import { pickFileAttachment, pickImageAttachment } from "../lib/attachments";
import { colors, typography } from "../theme";

const GROUP_WINDOW_MS = 10 * 60 * 1000;

export function ConversationScreen({
    navigation,
    route,
}: AppScreenProps<"Conversation">) {
    const { userID, username } = route.params;
    const allMessages = useStore($messages);
    const user = useStore($user);

    // Store keeps messages oldest-first; inverted FlatList needs newest-first
    const messages = useMemo(() => {
        const thread = allMessages[userID] ?? [];
        return [...thread].reverse();
    }, [allMessages, userID]);
    const identityVisibility = useMemo(
        () => buildIdentityVisibility(messages),
        [messages],
    );
    const latestMessageID = messages[0]?.mailID;

    useFocusEffect(
        useCallback(() => {
            // Dependency hook: rerun while focused whenever this thread receives
            // a new latest message.
            void latestMessageID;
            vexService.markRead(userID);
        }, [latestMessageID, userID]),
    );

    const [text, setText] = useState("");
    const [attachment, setAttachment] = useState<null | PickedAttachment>(null);
    const [editingMessage, setEditingMessage] = useState<Message | null>(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const sendInFlightRef = useRef(false);
    const insets = useSafeAreaInsets();

    const sendMessage = useCallback(async () => {
        const content = text.trim();
        const pendingEdit = editingMessage;
        const pendingAttachment = attachment;
        if (pendingEdit) {
            if (!content || !user || sendInFlightRef.current) {
                return;
            }
            sendInFlightRef.current = true;
            setSending(true);
            setError("");
            setText("");
            setEditingMessage(null);
            await waitForComposerPaint();
            try {
                const result = await vexService.editMessage(
                    userID,
                    pendingEdit.mailID,
                    false,
                    content,
                );
                if (!result.ok) {
                    setError(result.error ?? "Failed to edit message");
                    setText((current) => (current === "" ? content : current));
                    setEditingMessage((current) => current ?? pendingEdit);
                }
            } catch (err: unknown) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to edit message",
                );
                setText((current) => (current === "" ? content : current));
                setEditingMessage((current) => current ?? pendingEdit);
            } finally {
                sendInFlightRef.current = false;
                setSending(false);
            }
            return;
        }
        if (
            (!content && !pendingAttachment) ||
            !user ||
            sendInFlightRef.current
        ) {
            return;
        }
        sendInFlightRef.current = true;
        setSending(true);
        setError("");
        setText("");
        setAttachment(null);
        await waitForComposerPaint();
        try {
            let messageBody = content;
            if (pendingAttachment) {
                const uploaded = await vexService.uploadFileAttachment({
                    contentType: pendingAttachment.contentType,
                    data: pendingAttachment.data,
                    fileName: pendingAttachment.fileName,
                    fileSize: pendingAttachment.fileSize,
                });
                if (!uploaded.ok || !uploaded.attachment) {
                    setError(uploaded.error ?? "Failed to upload attachment");
                    setText((current) => (current === "" ? content : current));
                    setAttachment((current) =>
                        current === null ? pendingAttachment : current,
                    );
                    return;
                }
                const attachmentMarkdown = formatFileAttachmentMarkdown(
                    uploaded.attachment,
                );
                messageBody = messageBody
                    ? `${messageBody}\n\n${attachmentMarkdown}`
                    : attachmentMarkdown;
            }

            const result = await vexService.sendDM(userID, messageBody);
            if (!result.ok) {
                setError(result.error ?? "Failed to send");
                setText((current) => (current === "" ? content : current));
                setAttachment((current) =>
                    current === null ? pendingAttachment : current,
                );
                return;
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to send");
            setText((current) => (current === "" ? content : current));
            setAttachment((current) =>
                current === null ? pendingAttachment : current,
            );
        } finally {
            sendInFlightRef.current = false;
            setSending(false);
        }
    }, [attachment, editingMessage, text, user, userID, sendInFlightRef]);

    const handlePickAttachment = useCallback(
        (kind: "file" | "image") => {
            void (async () => {
                setError("");
                try {
                    const picked =
                        kind === "image"
                            ? await pickImageAttachment()
                            : await pickFileAttachment();
                    if (picked) {
                        setEditingMessage(null);
                        setAttachment(picked);
                    }
                } catch (err: unknown) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Could not attach file",
                    );
                }
            })();
        },
        [setAttachment],
    );

    const openAttachmentMenu = useCallback(() => {
        if (sending) return;
        Alert.alert("Attach", undefined, [
            { style: "cancel", text: "Cancel" },
            {
                onPress: () => {
                    handlePickAttachment("image");
                },
                text: "Photo",
            },
            {
                onPress: () => {
                    handlePickAttachment("file");
                },
                text: "File",
            },
        ]);
    }, [handlePickAttachment, sending]);

    const deleteMessageForEveryone = useCallback(
        (message: Message) => {
            void (async () => {
                const result = await vexService.deleteMessageForEveryone(
                    userID,
                    message.mailID,
                    false,
                );
                if (!result.ok) {
                    setError(
                        result.error ?? "Failed to delete message for everyone",
                    );
                }
            })();
        },
        [userID],
    );

    const deleteMessageForMe = useCallback(
        (message: Message) => {
            void (async () => {
                const deleted = await vexService.deleteLocalMessage(
                    userID,
                    message.mailID,
                    false,
                );
                if (!deleted) {
                    setError("Failed to delete local message");
                }
            })();
        },
        [userID],
    );

    const editMessage = useCallback((message: Message) => {
        setError("");
        setAttachment(null);
        setEditingMessage(message);
        setText(message.message);
    }, []);

    const toggleReaction = useCallback(
        (message: Message, emoji: MessageEmoji) => {
            void (async () => {
                const result = await vexService.toggleMessageReaction(
                    userID,
                    message.mailID,
                    false,
                    emoji,
                );
                if (!result.ok) {
                    setError(result.error ?? "Failed to update reaction");
                }
            })();
        },
        [userID],
    );

    function renderMessage({ index, item }: { index: number; item: Message }) {
        const isOwn = item.authorID === user?.userID;
        const ownName = user?.username ?? "Unknown";
        const showIdentity = identityVisibility[index] ?? true;
        return (
            <MessageBubbleRN
                authorName={isOwn ? ownName : username}
                currentUserID={user?.userID}
                isOwn={isOwn}
                message={item}
                onDeleteMessageForEveryone={deleteMessageForEveryone}
                onDeleteMessageForMe={deleteMessageForMe}
                onEditMessage={editMessage}
                onToggleReaction={toggleReaction}
                showIdentity={showIdentity}
            />
        );
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={insets.top}
            style={styles.container}
        >
            <ChatHeader
                onTitlePress={() => {
                    navigation.navigate("DMList");
                }}
                subtitle={`@${username}`}
                title="Direct Messages"
            />

            {messages.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>No messages yet.</Text>
                    <Text style={styles.emptyHint}>
                        Say hello to {username}!
                    </Text>
                </View>
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    data={messages}
                    inverted
                    keyExtractor={(m) => m.mailID}
                    renderItem={renderMessage}
                />
            )}

            {error !== "" && (
                <View style={styles.errorBar}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            <MessageInputBar
                attachment={attachment}
                bottomInset={insets.bottom}
                editing={editingMessage !== null}
                onAttachPress={openAttachmentMenu}
                onCancelEdit={() => {
                    setEditingMessage(null);
                    setText("");
                }}
                onChangeText={setText}
                onRemoveAttachment={() => {
                    setAttachment(null);
                }}
                onSend={() => void sendMessage()}
                onVoiceMemoError={setError}
                onVoiceMemoRecorded={setAttachment}
                placeholder={
                    editingMessage ? "Edit message" : `Message @${username}`
                }
                sending={sending}
                value={text}
            />
        </KeyboardAvoidingView>
    );
}

function waitForComposerPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    empty: {
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
    },
    emptyHint: {
        ...typography.body,
        color: colors.muted,
        fontSize: 11,
        marginTop: 4,
    },
    emptyText: {
        ...typography.body,
        color: colors.mutedDark,
        fontStyle: "italic",
    },
    errorBar: {
        backgroundColor: "rgba(229, 57, 53, 0.15)",
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    list: {
        paddingVertical: 8,
    },
});

function buildIdentityVisibility(messages: Message[]): boolean[] {
    const visibility = Array<boolean>(messages.length).fill(true);
    let chunkAuthorID: null | string = null;
    let chunkStartTs = 0;

    // Process oldest -> newest so chunk windows are stable.
    for (let index = messages.length - 1; index >= 0; index--) {
        const current = messages[index];
        if (!current || current.group === "__system__") {
            visibility[index] = true;
            chunkAuthorID = null;
            chunkStartTs = 0;
            continue;
        }

        const currentTs = Date.parse(current.timestamp);
        if (Number.isNaN(currentTs)) {
            visibility[index] = true;
            chunkAuthorID = null;
            chunkStartTs = 0;
            continue;
        }

        if (chunkAuthorID !== current.authorID) {
            visibility[index] = true;
            chunkAuthorID = current.authorID;
            chunkStartTs = currentTs;
            continue;
        }

        const elapsed = currentTs - chunkStartTs;
        if (elapsed >= 0 && elapsed <= GROUP_WINDOW_MS) {
            visibility[index] = false;
            continue;
        }

        visibility[index] = true;
        chunkStartTs = currentTs;
    }

    return visibility;
}
