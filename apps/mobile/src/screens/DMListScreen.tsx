import type { AppScreenProps } from "../navigation/types";
import type { User } from "@vex-chat/libvex";
import type { Message } from "@vex-chat/libvex";

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
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { $dmUnreadCounts } from "@vex-chat/store";
import { $familiars, $messages, vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";

import { Avatar } from "../components/Avatar";
import { ChatHeader } from "../components/ChatHeader";
import { VexField } from "../components/VexField";
import { colors, typography, useAccentColors } from "../theme";

const FRIENDS_DRAWER_WIDTH = 232;
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export function DMListScreen({ navigation }: AppScreenProps<"DMList">) {
    const accent = useAccentColors();
    const familiars = useStore($familiars);
    const allMessages = useStore($messages);
    const unreadCounts = useStore($dmUnreadCounts);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<User[]>([]);
    const [searching, setSearching] = useState(false);
    const [nowMs, setNowMs] = useState(0);
    const [friendsBarOpen, setFriendsBarOpen] = useState(false);
    const [friendsBarVisible, setFriendsBarVisible] = useState(false);
    const [friendsBarAnim] = useState(() => new Animated.Value(0));
    const timerRef = useRef<null | ReturnType<typeof setTimeout>>(null);

    const familiarList = useMemo(() => Object.values(familiars), [familiars]);
    const dmConversationList = useMemo(
        () =>
            familiarList.filter((user) => {
                const thread = allMessages[user.userID];
                return Boolean(thread && thread.length > 0);
            }),
        [allMessages, familiarList],
    );
    const friendsBackdropOpacity = useMemo(
        () =>
            friendsBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.34],
            }),
        [friendsBarAnim],
    );
    const friendsDrawerX = useMemo(
        () =>
            friendsBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [FRIENDS_DRAWER_WIDTH, 0],
            }),
        [friendsBarAnim],
    );

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

    function openFriendsBar(): void {
        setFriendsBarVisible(true);
        setFriendsBarOpen(true);
        Animated.spring(friendsBarAnim, {
            damping: 20,
            mass: 0.8,
            stiffness: 280,
            toValue: 1,
            useNativeDriver: true,
        }).start();
    }

    function closeFriendsBar(): void {
        setFriendsBarOpen(false);
        Animated.timing(friendsBarAnim, {
            duration: 180,
            toValue: 0,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                setFriendsBarVisible(false);
            }
        });
    }

    function toggleFriendsBar(): void {
        if (friendsBarOpen) {
            closeFriendsBar();
            return;
        }
        openFriendsBar();
    }

    const onSearch = useCallback((text: string) => {
        setQuery(text);
        if (timerRef.current) clearTimeout(timerRef.current);
        const q = text.trim();
        if (!q) {
            setResults([]);
            return;
        }
        setSearching(true);
        timerRef.current = setTimeout(() => {
            void (async () => {
                const user = await vexService.lookupUser(q);
                const found = user ? [user] : [];
                setResults(found);
                setSearching(false);
            })();
        }, 300);
    }, []);

    function openConversation(user: User) {
        // Familiars atom is readonly; vexService will add the user to familiars
        // automatically once a message is exchanged.
        setQuery("");
        setResults([]);
        if (friendsBarOpen) {
            closeFriendsBar();
        }
        navigation.navigate("Conversation", {
            userID: user.userID,
            username: user.username,
        });
    }

    function deleteThread(user: User): void {
        void (async () => {
            const deleted = await vexService.deleteLocalThread(
                user.userID,
                false,
            );
            if (!deleted) {
                Alert.alert(
                    "Could not delete conversation",
                    "The local history was not removed. Please try again.",
                );
            }
        })();
    }

    function deleteThreadForEveryone(user: User): void {
        void (async () => {
            const result = await vexService.deleteThreadForEveryone(
                user.userID,
                false,
            );
            if (!result.ok) {
                Alert.alert(
                    "Could not delete conversation",
                    result.error ??
                        "The delete request was not sent. Please try again.",
                );
                return;
            }
            if (!result.localDeleted) {
                Alert.alert(
                    "Remote delete sent",
                    "Your messages were queued for deletion, but local history was not removed.",
                );
            }
        })();
    }

    function confirmDeleteThread(user: User): void {
        Alert.alert(
            "Delete conversation?",
            `Delete local messages with ${user.username}, or delete your messages for everyone?`,
            [
                {
                    style: "cancel",
                    text: "Cancel",
                },
                {
                    onPress: () => {
                        deleteThread(user);
                    },
                    style: "destructive",
                    text: "Delete for me",
                },
                {
                    onPress: () => {
                        deleteThreadForEveryone(user);
                    },
                    style: "destructive",
                    text: "Delete for everyone",
                },
            ],
        );
    }

    function lastMessage(userID: string): Message | undefined {
        const thread = allMessages[userID];
        return thread?.[thread.length - 1];
    }

    function friendActivityText(user: User): string {
        const unread = unreadCounts[user.userID] ?? 0;
        if (unread > 0) {
            return `${unread} new`;
        }
        return lastMessage(user.userID) ? "Recently active" : "No messages yet";
    }

    function isOnline(user: User): boolean {
        if (!user.lastSeen) return false;
        const lastSeenMs = new Date(user.lastSeen).getTime();
        if (Number.isNaN(lastSeenMs)) return false;
        return nowMs - lastSeenMs < ONLINE_WINDOW_MS;
    }

    function renderFriendChip(user: User) {
        const unread = unreadCounts[user.userID] ?? 0;
        const online = isOnline(user);
        return (
            <TouchableOpacity
                key={user.userID}
                onPress={() => {
                    openConversation(user);
                }}
                style={styles.friendChip}
            >
                <View style={styles.friendAvatarWrap}>
                    <Avatar
                        displayName={user.username}
                        size={28}
                        userID={user.userID}
                    />
                    <View
                        style={[
                            styles.friendPresenceDot,
                            online
                                ? styles.friendPresenceDotOnline
                                : styles.friendPresenceDotOffline,
                        ]}
                    />
                </View>
                <View style={styles.friendMeta}>
                    <Text numberOfLines={1} style={styles.friendName}>
                        {user.username}
                    </Text>
                    <Text numberOfLines={1} style={styles.friendSubtext}>
                        {friendActivityText(user)}
                    </Text>
                </View>
                {unread > 0 && (
                    <View style={styles.friendUnreadDot}>
                        <Text style={styles.friendUnreadText}>
                            {unread > 99 ? "99+" : unread}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>
        );
    }

    function renderFriendBarItem({ item }: { item: User }) {
        return renderFriendChip(item);
    }

    function renderFamiliar({ item }: { item: User }) {
        const last = lastMessage(item.userID);
        const unread = unreadCounts[item.userID] ?? 0;
        return (
            <TouchableOpacity
                onLongPress={() => {
                    confirmDeleteThread(item);
                }}
                onPress={() => {
                    openConversation(item);
                }}
                style={[
                    styles.row,
                    unread > 0 && styles.rowUnread,
                    unread > 0 && { borderLeftColor: accent.accent },
                ]}
            >
                <Avatar
                    displayName={item.username}
                    size={40}
                    userID={item.userID}
                />
                <View style={styles.rowContent}>
                    <Text style={styles.username}>{item.username}</Text>
                    {last ? (
                        <Text numberOfLines={1} style={styles.preview}>
                            {last.message}
                        </Text>
                    ) : (
                        <Text numberOfLines={1} style={styles.previewEmpty}>
                            No messages yet
                        </Text>
                    )}
                </View>
                {unread > 0 && (
                    <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>
                            {unread > 99 ? "99+" : unread}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>
        );
    }

    function renderResult({ item }: { item: User }) {
        return (
            <TouchableOpacity
                onPress={() => {
                    openConversation(item);
                }}
                style={styles.resultRow}
            >
                <Avatar
                    displayName={item.username}
                    size={28}
                    userID={item.userID}
                />
                <Text style={styles.resultName}>{item.username}</Text>
            </TouchableOpacity>
        );
    }

    return (
        <VexField glows style={styles.container}>
            <ChatHeader
                onOverflow={() => {
                    toggleFriendsBar();
                }}
                overflowIcon="users"
                title="Direct Messages"
            />

            <View style={styles.searchWrap}>
                <View style={styles.searchBox}>
                    <Ionicons
                        color={colors.mutedDark}
                        name="search-outline"
                        size={16}
                    />
                    <TextInput
                        onChangeText={onSearch}
                        placeholder="Find users by exact username"
                        placeholderTextColor={colors.mutedDark}
                        style={styles.searchInput}
                        value={query}
                    />
                </View>
            </View>

            {results.length > 0 && (
                <FlatList
                    data={results}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(u) => u.userID}
                    renderItem={renderResult}
                    style={styles.resultsList}
                />
            )}

            {query.trim() !== "" && results.length === 0 && !searching && (
                <Text style={styles.noResults}>No users found</Text>
            )}

            {searching && <Text style={styles.noResults}>Searching...</Text>}

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>DIRECT MESSAGES</Text>
                <Text style={styles.sectionMeta}>
                    {dmConversationList.length}
                </Text>
            </View>

            {dmConversationList.length === 0 && !query.trim() ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>No conversations yet</Text>
                    <Text style={styles.emptyHint}>
                        Search for a user to start messaging
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={dmConversationList}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(u) => u.userID}
                    renderItem={renderFamiliar}
                />
            )}

            {friendsBarVisible && (
                <>
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.friendsBackdrop,
                            { opacity: friendsBackdropOpacity },
                        ]}
                    />
                    <Pressable
                        onPress={() => {
                            closeFriendsBar();
                        }}
                        style={styles.friendsBackdropPressable}
                    />
                    <Animated.View
                        pointerEvents="auto"
                        style={[
                            styles.friendsDrawer,
                            { transform: [{ translateX: friendsDrawerX }] },
                        ]}
                    >
                        <View style={styles.friendsDrawerHeader}>
                            <Text style={styles.sectionTitle}>FRIENDS</Text>
                            <Text style={styles.sectionMeta}>
                                {familiarList.length}
                            </Text>
                        </View>
                        {familiarList.length === 0 ? (
                            <Text style={styles.noFriendsText}>
                                No friends yet. Search for someone to start
                                chatting.
                            </Text>
                        ) : (
                            <FlatList
                                data={familiarList}
                                keyExtractor={(u) => u.userID}
                                renderItem={renderFriendBarItem}
                            />
                        )}
                    </Animated.View>
                </>
            )}
        </VexField>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    empty: {
        alignItems: "center",
        marginTop: 8,
        paddingHorizontal: 16,
        paddingVertical: 18,
    },
    emptyHint: {
        ...typography.body,
        color: colors.muted,
        marginTop: 4,
        textAlign: "center",
    },
    emptyText: {
        ...typography.button,
        color: colors.textSecondary,
        textTransform: "uppercase",
    },
    friendAvatarWrap: {
        position: "relative",
    },
    friendChip: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        marginRight: 8,
        minWidth: 150,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    friendMeta: {
        flex: 1,
        gap: 1,
    },
    friendName: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 12,
    },
    friendPresenceDot: {
        borderColor: colors.panel,
        borderRadius: 999,
        borderWidth: 2,
        bottom: -1,
        height: 10,
        position: "absolute",
        right: -1,
        width: 10,
    },
    friendPresenceDotOffline: {
        backgroundColor: colors.offline,
    },
    friendPresenceDotOnline: {
        backgroundColor: colors.online,
    },
    friendsBackdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: colors.overlay,
    },
    friendsBackdropPressable: {
        ...StyleSheet.absoluteFill,
    },
    friendsDrawer: {
        backgroundColor: colors.panel,
        borderLeftColor: colors.borderSubtle,
        borderLeftWidth: 1,
        bottom: 0,
        paddingTop: 56,
        position: "absolute",
        right: 0,
        top: 0,
        width: FRIENDS_DRAWER_WIDTH,
    },
    friendsDrawerHeader: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    friendSubtext: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 10,
    },
    friendUnreadDot: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderRadius: 10,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    friendUnreadText: {
        color: "#fff",
        fontSize: 10,
        fontWeight: "700",
    },
    noFriendsText: {
        ...typography.body,
        color: colors.mutedDark,
        marginTop: 6,
        paddingHorizontal: 14,
    },
    noResults: {
        ...typography.body,
        color: colors.muted,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    preview: {
        ...typography.body,
        color: colors.muted,
        lineHeight: 18,
        marginTop: 2,
    },
    previewEmpty: {
        ...typography.body,
        color: colors.mutedDark,
        lineHeight: 18,
        marginTop: 2,
    },
    resultName: {
        ...typography.button,
        color: colors.textSecondary,
    },
    resultRow: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    resultsList: {
        marginHorizontal: 16,
        maxHeight: 220,
    },
    row: {
        alignItems: "center",
        backgroundColor: colors.transparent,
        borderRadius: 6,
        flexDirection: "row",
        gap: 12,
        marginBottom: 2,
        marginHorizontal: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    rowContent: {
        flex: 1,
    },
    rowUnread: {
        backgroundColor: colors.surfaceLight,
        borderLeftWidth: 2,
    },
    searchBox: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.borderSubtle,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        minHeight: 42,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    searchInput: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
        fontSize: 14,
        padding: 0,
    },
    searchWrap: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    sectionHeader: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    sectionMeta: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 11,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.mutedDark,
    },
    unreadBadge: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderRadius: 12,
        height: 22,
        justifyContent: "center",
        minWidth: 24,
        paddingHorizontal: 6,
    },
    unreadText: {
        color: "#fff",
        fontSize: 11,
        fontWeight: "700",
    },
    username: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 15,
    },
});
