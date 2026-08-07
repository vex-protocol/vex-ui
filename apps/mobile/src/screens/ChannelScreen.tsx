import type { PickedAttachment } from "../lib/attachments";
import type { AppScreenProps } from "../navigation/types";
import type { Message, Permission, User } from "@vex-chat/libvex";
import type { MessageEmoji } from "@vex-chat/store";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Alert,
    Animated,
    Easing,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    $groupMessages,
    $permissions,
    $servers,
    $user,
    buildMessageReplyReference,
    createReplyExtra,
    formatFileAttachmentMarkdown,
    messageReply,
    vexService,
} from "@vex-chat/store";

import { useStore } from "@nanostores/react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../components/Avatar";
import { ChatHeader } from "../components/ChatHeader";
import { MessageBubbleRN } from "../components/MessageBubbleRN";
import { MessageInputBar } from "../components/MessageInputBar";
import { VexField } from "../components/VexField";
import {
    cameraPhotoAttachmentFromUri,
    pickFileAttachment,
    pickImageAttachment,
} from "../lib/attachments";
import {
    $cameraCaptureResult,
    clearCameraCaptureResult,
} from "../lib/cameraCaptureResult";
import { haptic } from "../lib/haptics";
import { $leftSidebarOpen, $rightSidebarOpen } from "../lib/sidebarState";
import { colors, typography } from "../theme";

const GROUP_WINDOW_MS = 10 * 60 * 1000;
const MEMBERS_DRAWER_WIDTH = 232;
const ONLINE_WINDOW_MS = 15 * 60 * 1000;
// Match the left sidebar's "machined slot-in" feel.
const MEMBERS_OPEN_DURATION_MS = 240;
const MEMBERS_CLOSE_DURATION_MS = 180;
const MEMBERS_OPEN_EASING = Easing.bezier(0.2, 0.0, 0.0, 1.0);
const MEMBERS_CLOSE_EASING = Easing.bezier(0.4, 0.0, 0.2, 1.0);
// Click-CLICK pair fires faster than the visual settle; matches
// the left sidebar's machined-detent feel.
const MEMBERS_SLOT_HAPTIC_INTERVAL_MS = 95;

export function ChannelScreen({
    navigation,
    route,
}: AppScreenProps<"Channel">) {
    const { channelID, channelName, serverID } = route.params;
    const allGroupMessages = useStore($groupMessages);
    const permissions = useStore($permissions);
    // Scoped to just this server's slot so other server churn doesn't re-render us.
    const servers = useStore($servers);
    const cameraCaptureResult = useStore($cameraCaptureResult);
    const user = useStore($user);
    const serverName = servers[serverID]?.name ?? "";

    // Store keeps messages oldest-first; inverted FlatList needs newest-first
    const messages = useMemo(() => {
        const thread = allGroupMessages[channelID] ?? [];
        return [...thread].reverse();
    }, [allGroupMessages, channelID]);
    const messageByID = useMemo(
        () => new Map(messages.map((message) => [message.mailID, message])),
        [messages],
    );
    const identityVisibility = useMemo(
        () => buildIdentityVisibility(messages),
        [messages],
    );
    const latestMessageID = messages[0]?.mailID;

    useFocusEffect(
        useCallback(() => {
            // Dependency hook: rerun while focused whenever this channel receives
            // a new latest message.
            void latestMessageID;
            vexService.markRead(channelID);
        }, [channelID, latestMessageID]),
    );

    const insets = useSafeAreaInsets();
    const [text, setText] = useState("");
    const [attachment, setAttachment] = useState<null | PickedAttachment>(null);
    const [editingMessage, setEditingMessage] = useState<Message | null>(null);
    const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(
        null,
    );
    const [sending, setSending] = useState(false);
    const [attachingCameraPhoto, setAttachingCameraPhoto] = useState(false);
    const [sendError, setSendError] = useState("");
    const sendInFlightRef = useRef(false);
    const cameraAttachmentInFlightRef = useRef(false);
    const handledCameraCaptureRequestIdRef = useRef<null | number>(null);
    const listRef = useRef<FlatList<Message>>(null);
    const [members, setMembers] = useState<User[]>([]);
    const [serverPermissions, setServerPermissions] = useState<Permission[]>(
        [],
    );
    const [kickingMemberID, setKickingMemberID] = useState<null | string>(null);
    const [usernames, setUsernames] = useState<Record<string, string>>({});
    const [nowMs, setNowMs] = useState(0);
    const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
    const [membersDrawerVisible, setMembersDrawerVisible] = useState(false);
    const [membersDrawerAnim] = useState(() => new Animated.Value(0));
    const leftSidebarOpen = useStore($leftSidebarOpen);
    const authorNameForMessage = useCallback(
        (message: Message): string =>
            message.authorID === user?.userID
                ? (user?.username ?? "Unknown")
                : (usernames[message.authorID] ?? message.authorID.slice(0, 8)),
        [user?.userID, user?.username, usernames],
    );
    const liveReplyingToMessage = replyingToMessage
        ? (messageByID.get(replyingToMessage.mailID) ?? replyingToMessage)
        : null;
    const replyReference = useMemo(
        () =>
            liveReplyingToMessage
                ? buildMessageReplyReference(
                      liveReplyingToMessage,
                      authorNameForMessage(liveReplyingToMessage),
                  )
                : null,
        [authorNameForMessage, liveReplyingToMessage],
    );

    useFocusEffect(
        useCallback(() => {
            if (
                !cameraCaptureResult ||
                handledCameraCaptureRequestIdRef.current ===
                    cameraCaptureResult.requestId
            ) {
                return;
            }
            if (
                cameraCaptureResult.source.kind !== "channel" ||
                cameraCaptureResult.source.channelID !== channelID ||
                cameraCaptureResult.source.serverID !== serverID
            ) {
                return;
            }
            handledCameraCaptureRequestIdRef.current =
                cameraCaptureResult.requestId;
            clearCameraCaptureResult();
            cameraAttachmentInFlightRef.current = true;
            setAttachingCameraPhoto(true);

            void (async () => {
                setSendError("");
                try {
                    const picked = await cameraPhotoAttachmentFromUri({
                        height: cameraCaptureResult.height,
                        uri: cameraCaptureResult.uri,
                        width: cameraCaptureResult.width,
                    });
                    setEditingMessage(null);
                    setAttachment(picked);
                } catch (err: unknown) {
                    setSendError(
                        err instanceof Error
                            ? err.message
                            : "Could not attach photo",
                    );
                } finally {
                    cameraAttachmentInFlightRef.current = false;
                    setAttachingCameraPhoto(false);
                }
            })();
        }, [cameraCaptureResult, channelID, serverID]),
    );

    const membersBackdropOpacity = useMemo(
        () =>
            membersDrawerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.34],
            }),
        [membersDrawerAnim],
    );
    const membersDrawerX = useMemo(
        () =>
            membersDrawerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [MEMBERS_DRAWER_WIDTH, 0],
            }),
        [membersDrawerAnim],
    );

    const ownerUserIDs = useMemo(
        () =>
            new Set(
                [...serverPermissions, ...Object.values(permissions)]
                    .filter(
                        (permission) =>
                            permission.resourceID === serverID &&
                            permission.resourceType === "server" &&
                            permission.powerLevel >= 100,
                    )
                    .map((permission) => permission.userID),
            ),
        [permissions, serverID, serverPermissions],
    );
    const myServerPowerLevel = useMemo(() => {
        const myUserID = user?.userID;
        if (!myUserID) {
            return 0;
        }
        const myPermissions = [
            ...serverPermissions,
            ...Object.values(permissions),
        ].filter(
            (permission) =>
                permission.resourceID === serverID &&
                permission.resourceType === "server" &&
                permission.userID === myUserID,
        );
        if (myPermissions.length === 0) {
            return 0;
        }
        return Math.max(
            ...myPermissions.map((permission) => permission.powerLevel),
        );
    }, [permissions, serverID, serverPermissions, user?.userID]);
    const canKickMembers = myServerPowerLevel >= 100;

    const syncChannelMembers = useCallback(async (): Promise<void> => {
        const [channelMembers, fetchedPermissions] = await Promise.all([
            vexService.getChannelMembers(channelID),
            vexService
                .getServerPermissions(serverID)
                .catch((): Permission[] => []),
        ]);
        setMembers(channelMembers);
        setServerPermissions(fetchedPermissions);
        const map: Record<string, string> = {};
        for (const member of channelMembers) {
            map[member.userID] = member.username;
        }
        setUsernames(map);
    }, [channelID, serverID]);

    // Load channel members to resolve userIDs → usernames
    useEffect(() => {
        void syncChannelMembers().catch(() => {});
    }, [syncChannelMembers]);

    useEffect(() => {
        const tick = () => {
            setNowMs(Date.now());
        };
        tick();
        const interval = setInterval(tick, 60_000);
        return () => {
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (!membersDrawerOpen) return;
        void syncChannelMembers().catch(() => {});
        const interval = setInterval(() => {
            void syncChannelMembers().catch(() => {});
        }, 30_000);
        return () => {
            clearInterval(interval);
        };
    }, [membersDrawerOpen, syncChannelMembers]);

    // Pending haptic timer for the members drawer click+CLICK pair.
    const membersLandingHapticRef = useRef<(() => void) | null>(null);
    const cancelPendingMembersHaptic = (): void => {
        if (membersLandingHapticRef.current) {
            membersLandingHapticRef.current();
            membersLandingHapticRef.current = null;
        }
    };

    const openMembersDrawer = useCallback((): void => {
        $leftSidebarOpen.set(false);
        $rightSidebarOpen.set(true);
        setMembersDrawerVisible(true);
        setMembersDrawerOpen(true);
        cancelPendingMembersHaptic();
        haptic("slotIn");
        membersLandingHapticRef.current = haptic.scheduled(
            "slotOut",
            MEMBERS_SLOT_HAPTIC_INTERVAL_MS,
        );
        Animated.timing(membersDrawerAnim, {
            duration: MEMBERS_OPEN_DURATION_MS,
            easing: MEMBERS_OPEN_EASING,
            toValue: 1,
            useNativeDriver: true,
        }).start();
    }, [membersDrawerAnim]);

    const closeMembersDrawer = useCallback((): void => {
        $rightSidebarOpen.set(false);
        setMembersDrawerOpen(false);
        cancelPendingMembersHaptic();
        haptic("slotIn");
        membersLandingHapticRef.current = haptic.scheduled(
            "slotOut",
            MEMBERS_SLOT_HAPTIC_INTERVAL_MS,
        );
        Animated.timing(membersDrawerAnim, {
            duration: MEMBERS_CLOSE_DURATION_MS,
            easing: MEMBERS_CLOSE_EASING,
            toValue: 0,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                setMembersDrawerVisible(false);
            }
        });
    }, [membersDrawerAnim]);

    const toggleMembersDrawer = useCallback((): void => {
        if (membersDrawerOpen) {
            closeMembersDrawer();
            return;
        }
        openMembersDrawer();
    }, [closeMembersDrawer, membersDrawerOpen, openMembersDrawer]);

    useEffect(() => {
        if (leftSidebarOpen && membersDrawerOpen) {
            closeMembersDrawer();
        }
    }, [closeMembersDrawer, leftSidebarOpen, membersDrawerOpen]);

    useEffect(() => {
        return () => {
            $rightSidebarOpen.set(false);
        };
    }, []);

    const isOnline = useCallback(
        (member: User): boolean => {
            if (!member.lastSeen) return false;
            const lastSeenMs = new Date(member.lastSeen).getTime();
            if (Number.isNaN(lastSeenMs)) return false;
            return nowMs - lastSeenMs < ONLINE_WINDOW_MS;
        },
        [nowMs],
    );

    const orderedMembers = useMemo(
        () => sortMembers(members, ownerUserIDs, isOnline),
        [isOnline, members, ownerUserIDs],
    );

    function confirmKickMember(member: User): void {
        if (
            !canKickMembers ||
            ownerUserIDs.has(member.userID) ||
            member.userID === user?.userID
        ) {
            return;
        }
        Alert.alert("Kick member?", `Remove ${member.username} from server?`, [
            { style: "cancel", text: "Cancel" },
            {
                onPress: () => {
                    void handleKickMember(member);
                },
                style: "destructive",
                text: "Kick",
            },
        ]);
    }

    async function handleKickMember(member: User): Promise<void> {
        if (
            !canKickMembers ||
            kickingMemberID ||
            ownerUserIDs.has(member.userID) ||
            member.userID === user?.userID
        ) {
            return;
        }
        setKickingMemberID(member.userID);
        try {
            const result = await vexService.kickServerMember(
                serverID,
                member.userID,
            );
            if (!result.ok) {
                Alert.alert(
                    "Kick failed",
                    result.error ?? "Could not remove this member.",
                );
                return;
            }
            setMembers((current) =>
                current.filter((item) => item.userID !== member.userID),
            );
            void syncChannelMembers().catch(() => {});
        } finally {
            setKickingMemberID(null);
        }
    }

    const sendMessage = useCallback(async () => {
        const content = text.trim();
        const pendingEdit = editingMessage;
        const pendingAttachment = attachment;
        const pendingReply = liveReplyingToMessage;
        if (pendingEdit) {
            if (
                !content ||
                !user ||
                sendInFlightRef.current ||
                cameraAttachmentInFlightRef.current
            ) {
                return;
            }
            sendInFlightRef.current = true;
            setSending(true);
            setSendError("");
            setText("");
            setEditingMessage(null);
            setReplyingToMessage(null);
            await waitForComposerPaint();
            try {
                const result = await vexService.editMessage(
                    channelID,
                    pendingEdit.mailID,
                    true,
                    content,
                );
                if (!result.ok) {
                    setSendError(result.error ?? "Failed to edit message");
                    setText((current) => (current === "" ? content : current));
                    setEditingMessage((current) => current ?? pendingEdit);
                }
            } catch (err: unknown) {
                setSendError(
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
            sendInFlightRef.current ||
            cameraAttachmentInFlightRef.current
        ) {
            return;
        }
        sendInFlightRef.current = true;
        setSending(true);
        setSendError("");
        setText("");
        setAttachment(null);
        setReplyingToMessage(null);
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
                    setSendError(
                        uploaded.error ?? "Failed to upload attachment",
                    );
                    setText((current) => (current === "" ? content : current));
                    setAttachment((current) =>
                        current === null ? pendingAttachment : current,
                    );
                    if (pendingReply) {
                        setReplyingToMessage((current) =>
                            current === null ? pendingReply : current,
                        );
                    }
                    return;
                }
                const attachmentMarkdown = formatFileAttachmentMarkdown(
                    uploaded.attachment,
                );
                messageBody = messageBody
                    ? `${messageBody}\n\n${attachmentMarkdown}`
                    : attachmentMarkdown;
            }

            const replyExtra = pendingReply
                ? createReplyExtra(
                      pendingReply,
                      authorNameForMessage(pendingReply),
                  )
                : undefined;
            const result = await vexService.sendGroupMessage(
                channelID,
                messageBody,
                replyExtra ? { extra: replyExtra } : undefined,
            );
            if (!result.ok) {
                setSendError(result.error ?? "Failed to send");
                setText((current) => (current === "" ? content : current));
                setAttachment((current) =>
                    current === null ? pendingAttachment : current,
                );
                if (pendingReply) {
                    setReplyingToMessage((current) =>
                        current === null ? pendingReply : current,
                    );
                }
                return;
            }
        } catch (err: unknown) {
            setSendError(err instanceof Error ? err.message : "Failed to send");
            setText((current) => (current === "" ? content : current));
            setAttachment((current) =>
                current === null ? pendingAttachment : current,
            );
            if (pendingReply) {
                setReplyingToMessage((current) =>
                    current === null ? pendingReply : current,
                );
            }
        } finally {
            sendInFlightRef.current = false;
            setSending(false);
        }
    }, [
        attachment,
        authorNameForMessage,
        editingMessage,
        liveReplyingToMessage,
        text,
        user,
        channelID,
        sendInFlightRef,
    ]);

    const handlePickAttachment = useCallback(
        (kind: "file" | "image") => {
            void (async () => {
                setSendError("");
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
                    setSendError(
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
        if (sending || attachingCameraPhoto) return;
        Alert.alert("Attach", undefined, [
            { style: "cancel", text: "Cancel" },
            {
                onPress: () => {
                    setSendError("");
                    navigation.navigate("CameraCapture", {
                        source: { channelID, kind: "channel", serverID },
                    });
                },
                text: "Camera",
            },
            {
                onPress: () => {
                    handlePickAttachment("image");
                },
                text: "Photo Library",
            },
            {
                onPress: () => {
                    handlePickAttachment("file");
                },
                text: "File",
            },
        ]);
    }, [
        attachingCameraPhoto,
        channelID,
        handlePickAttachment,
        navigation,
        sending,
        serverID,
    ]);

    const deleteMessageForEveryone = useCallback(
        (message: Message) => {
            void (async () => {
                const result = await vexService.deleteMessageForEveryone(
                    channelID,
                    message.mailID,
                    true,
                );
                if (!result.ok) {
                    setSendError(
                        result.error ?? "Failed to delete message for everyone",
                    );
                }
            })();
        },
        [channelID],
    );

    const deleteMessageForMe = useCallback(
        (message: Message) => {
            void (async () => {
                const deleted = await vexService.deleteLocalMessage(
                    channelID,
                    message.mailID,
                    true,
                );
                if (!deleted) {
                    setSendError("Failed to delete local message");
                }
            })();
        },
        [channelID],
    );

    const editMessage = useCallback((message: Message) => {
        setSendError("");
        setAttachment(null);
        setReplyingToMessage(null);
        setEditingMessage(message);
        setText(message.message);
    }, []);

    const replyToMessage = useCallback((message: Message) => {
        setSendError("");
        setEditingMessage(null);
        setReplyingToMessage(message);
    }, []);

    const scrollToMessage = useCallback(
        (mailID: string) => {
            const index = messages.findIndex(
                (message) => message.mailID === mailID,
            );
            if (index === -1) {
                return;
            }
            listRef.current?.scrollToIndex({
                animated: true,
                index,
                viewPosition: 0.45,
            });
        },
        [messages],
    );

    const toggleReaction = useCallback(
        (message: Message, emoji: MessageEmoji) => {
            void (async () => {
                const result = await vexService.toggleMessageReaction(
                    channelID,
                    message.mailID,
                    true,
                    emoji,
                );
                if (!result.ok) {
                    setSendError(result.error ?? "Failed to update reaction");
                }
            })();
        },
        [channelID],
    );

    function renderMessage({ index, item }: { index: number; item: Message }) {
        const isOwn = item.authorID === user?.userID;
        const showIdentity = identityVisibility[index] ?? true;
        const reply = messageReply(item);
        const targetMessage = reply
            ? messageByID.get(reply.targetMailID)
            : undefined;
        return (
            <MessageBubbleRN
                authorName={authorNameForMessage(item)}
                currentUserID={user?.userID}
                isOwn={isOwn}
                message={item}
                onDeleteMessageForEveryone={deleteMessageForEveryone}
                onDeleteMessageForMe={deleteMessageForMe}
                onEditMessage={editMessage}
                onPressReplyTarget={scrollToMessage}
                onReplyMessage={replyToMessage}
                onToggleReaction={toggleReaction}
                replyTarget={
                    targetMessage
                        ? {
                              authorName: authorNameForMessage(targetMessage),
                              message: targetMessage,
                          }
                        : null
                }
                showIdentity={showIdentity}
            />
        );
    }

    function renderMember({ item }: { item: User }) {
        const online = isOnline(item);
        const owner = ownerUserIDs.has(item.userID);
        const kickingThisMember = kickingMemberID === item.userID;
        const canKickMember =
            canKickMembers &&
            !owner &&
            item.userID !== user?.userID &&
            (kickingMemberID === null || kickingThisMember);
        return (
            <View style={styles.memberRow}>
                <View style={styles.memberAvatarWrap}>
                    <Avatar
                        displayName={item.username}
                        size={36}
                        userID={item.userID}
                    />
                    <View
                        style={[
                            styles.memberPresenceDot,
                            online
                                ? styles.memberPresenceDotOnline
                                : styles.memberPresenceDotOffline,
                        ]}
                    />
                </View>
                <View style={styles.memberMeta}>
                    <View style={styles.memberNameRow}>
                        <Text numberOfLines={1} style={styles.memberName}>
                            {item.username}
                        </Text>
                        {owner ? (
                            <Text
                                accessibilityLabel="Server owner"
                                style={styles.memberOwnerCrown}
                            >
                                ♕
                            </Text>
                        ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.memberSubtext}>
                        {owner
                            ? `Owner - ${online ? "Online" : "Offline"}`
                            : online
                              ? "Online"
                              : "Offline"}
                    </Text>
                </View>
                {canKickMember ? (
                    <TouchableOpacity
                        accessibilityLabel={`Kick ${item.username}`}
                        disabled={kickingMemberID !== null}
                        onPress={() => {
                            confirmKickMember(item);
                        }}
                        style={[
                            styles.memberKickButton,
                            kickingMemberID !== null &&
                                styles.memberKickButtonDisabled,
                        ]}
                    >
                        <Text style={styles.memberKickText}>
                            {kickingThisMember ? "Kicking..." : "Kick"}
                        </Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={insets.top}
            style={styles.container}
        >
            <VexField style={styles.field}>
                <ChatHeader
                    onOverflow={() => {
                        navigation.navigate("ServerSettings", {
                            serverID,
                            serverName,
                        });
                    }}
                    onUsers={() => {
                        toggleMembersDrawer();
                    }}
                    subtitle={`# ${channelName}`}
                    title={serverName || "Server"}
                />

                <FlatList
                    contentContainerStyle={styles.list}
                    data={messages}
                    inverted
                    keyExtractor={(m) => m.mailID}
                    onScrollToIndexFailed={(info) => {
                        listRef.current?.scrollToOffset({
                            animated: true,
                            offset: info.averageItemLength * info.index,
                        });
                    }}
                    ref={listRef}
                    renderItem={renderMessage}
                    style={styles.messagePane}
                />

                {sendError !== "" && (
                    <View style={styles.errorBar}>
                        <Text style={styles.errorText}>{sendError}</Text>
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
                    onCancelReply={() => {
                        setReplyingToMessage(null);
                    }}
                    onChangeText={setText}
                    onRemoveAttachment={() => {
                        setAttachment(null);
                    }}
                    onSend={() => void sendMessage()}
                    onVoiceMemoError={setSendError}
                    onVoiceMemoRecorded={setAttachment}
                    placeholder={
                        editingMessage
                            ? "Edit message"
                            : `Message #${channelName}`
                    }
                    replyingTo={replyReference}
                    sending={sending || attachingCameraPhoto}
                    value={text}
                />
                {membersDrawerVisible && (
                    <>
                        <Animated.View
                            pointerEvents="none"
                            style={[
                                styles.membersBackdrop,
                                { opacity: membersBackdropOpacity },
                            ]}
                        />
                        <Pressable
                            onPress={() => {
                                closeMembersDrawer();
                            }}
                            style={styles.membersBackdropPressable}
                        />
                        <Animated.View
                            pointerEvents="auto"
                            style={[
                                styles.membersDrawer,
                                { transform: [{ translateX: membersDrawerX }] },
                            ]}
                        >
                            <View style={styles.membersDrawerHeader}>
                                <Text style={styles.membersDrawerTitle}>
                                    MEMBERS
                                </Text>
                                <Text style={styles.membersDrawerMeta}>
                                    {members.length}
                                </Text>
                            </View>
                            {members.length === 0 ? (
                                <Text style={styles.membersEmptyText}>
                                    No members found for this channel.
                                </Text>
                            ) : (
                                <FlatList
                                    data={orderedMembers}
                                    keyExtractor={(member) => member.userID}
                                    renderItem={renderMember}
                                />
                            )}
                        </Animated.View>
                    </>
                )}
            </VexField>
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
    errorBar: {
        backgroundColor: colors.dangerBg,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    field: {
        flex: 1,
    },
    list: {
        paddingBottom: 6,
        paddingTop: 6,
    },
    memberAvatarWrap: {
        position: "relative",
    },
    memberKickButton: {
        borderColor: "rgba(255,122,122,0.42)",
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 5,
    },
    memberKickButtonDisabled: {
        opacity: 0.45,
    },
    memberKickText: {
        ...typography.button,
        color: colors.error,
        fontSize: 10,
    },
    memberMeta: {
        flex: 1,
        gap: 1,
    },
    memberName: {
        ...typography.button,
        color: colors.textSecondary,
        flexShrink: 1,
        fontSize: 12,
    },
    memberNameRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 4,
        minWidth: 0,
    },
    memberOwnerCrown: {
        color: "#FFD76A",
        fontSize: 13,
        lineHeight: 16,
    },
    memberPresenceDot: {
        borderColor: colors.panel,
        borderRadius: 999,
        borderWidth: 2,
        bottom: -1,
        height: 10,
        position: "absolute",
        right: -1,
        width: 10,
    },
    memberPresenceDotOffline: {
        backgroundColor: colors.offline,
    },
    memberPresenceDotOnline: {
        backgroundColor: colors.online,
    },
    memberRow: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        marginRight: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    membersBackdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: colors.overlay,
    },
    membersBackdropPressable: {
        ...StyleSheet.absoluteFill,
    },
    membersDrawer: {
        backgroundColor: colors.panel,
        borderLeftColor: colors.borderSubtle,
        borderLeftWidth: 1,
        bottom: 0,
        paddingTop: 56,
        position: "absolute",
        right: 0,
        top: 0,
        width: MEMBERS_DRAWER_WIDTH,
    },
    membersDrawerHeader: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    membersDrawerMeta: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 11,
    },
    membersDrawerTitle: {
        ...typography.label,
        color: colors.mutedDark,
    },
    membersEmptyText: {
        ...typography.body,
        color: colors.mutedDark,
        marginTop: 6,
        paddingHorizontal: 14,
    },
    memberSubtext: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 10,
    },
    messagePane: {
        flex: 1,
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

        if (messageReply(current)) {
            visibility[index] = true;
            chunkAuthorID = current.authorID;
            chunkStartTs = currentTs;
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

function sortMembers(
    members: User[],
    ownerUserIDs: Set<string>,
    isOnline: (member: User) => boolean,
): User[] {
    return [...members].sort((a, b) => {
        const ownerDelta =
            Number(ownerUserIDs.has(b.userID)) -
            Number(ownerUserIDs.has(a.userID));
        if (ownerDelta !== 0) {
            return ownerDelta;
        }
        const onlineDelta = Number(isOnline(b)) - Number(isOnline(a));
        if (onlineDelta !== 0) {
            return onlineDelta;
        }
        return a.username.localeCompare(b.username);
    });
}
