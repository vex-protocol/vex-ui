import type { Channel, User } from "@vex-chat/libvex";

import React from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    $channels,
    $channelUnreadCounts,
    $dmUnreadCounts,
    $familiars,
    $messages,
    $servers,
    $totalDmUnread,
    $user,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";

import { haptic } from "../lib/haptics";
import { colors, useAccentColors } from "../theme";

import { Avatar } from "./Avatar";
import { ServerIcon } from "./ServerIcon";

interface ServerSidebarProps {
    activeChannelId: null | string;
    activeDmUserId: null | string;
    activeServerId: null | string;
    authStatus:
        | "authenticated"
        | "checking"
        | "offline"
        | "signed_out"
        | "unauthorized";
    channels: Channel[];
    currentServerName: string;
    onAddServer: () => void;
    onSelectChannel: (channel: Channel) => void;
    onSelectDM: (user: User) => void;
    onSelectHome: () => void;
    onSelectServer: (serverId: string) => void;
    onSettings: () => void;
    safeAreaBottom?: number;
    safeAreaTop?: number;
}

export function ServerSidebar({
    activeChannelId,
    activeDmUserId,
    activeServerId,
    authStatus,
    channels,
    currentServerName,
    onAddServer,
    onSelectChannel,
    onSelectDM,
    onSelectHome,
    onSelectServer,
    onSettings,
    safeAreaBottom = 0,
    safeAreaTop = 0,
}: ServerSidebarProps) {
    const accent = useAccentColors();
    const servers = useStore($servers);
    const allChannels = useStore($channels);
    const familiars = useStore($familiars);
    const messages = useStore($messages);
    const dmUnreadCounts = useStore($dmUnreadCounts);
    const channelUnreadCounts = useStore($channelUnreadCounts);
    const me = useStore($user);
    const serverList = Object.values(servers);
    const serverUnreadCounts = React.useMemo(() => {
        const totals: Record<string, number> = {};
        for (const [serverID, serverChannels] of Object.entries(allChannels)) {
            const total = serverChannels.reduce(
                (sum, channel) =>
                    sum + (channelUnreadCounts[channel.channelID] ?? 0),
                0,
            );
            if (total > 0) {
                totals[serverID] = total;
            }
        }
        return totals;
    }, [allChannels, channelUnreadCounts]);
    const dmList = Object.values(familiars).filter((user) => {
        const thread = messages[user.userID];
        return Boolean(thread && thread.length > 0);
    });
    const totalDmUnread = useStore($totalDmUnread);
    const homeActive = activeServerId === null;

    const authDotStyle = [
        styles.profileAuthDot,
        authStatus === "authenticated" && styles.authDotAuthenticated,
        authStatus === "checking" && styles.authDotChecking,
        authStatus === "offline" && styles.authDotOffline,
        authStatus === "signed_out" && styles.authDotSignedOut,
        authStatus === "unauthorized" && styles.authDotUnauthorized,
    ];

    const authStatusLabel: string = (() => {
        switch (authStatus) {
            case "authenticated":
                return "Online";
            case "checking":
                return "Connecting...";
            case "offline":
                return "Offline";
            case "signed_out":
                return "Signed out";
            case "unauthorized":
                return "Unauthorized";
            default:
                return "";
        }
    })();

    return (
        <View style={styles.drawerContainer}>
            <View style={styles.topRow}>
                <View
                    style={[
                        styles.railContainer,
                        { paddingTop: safeAreaTop + 10 },
                    ]}
                >
                    <View style={styles.topSection}>
                        <View
                            style={[
                                styles.activePill,
                                { backgroundColor: accent.accent },
                                homeActive && styles.activePillVisible,
                            ]}
                        />
                        <TouchableOpacity
                            accessibilityLabel="Direct messages"
                            accessibilityRole="button"
                            activeOpacity={0.78}
                            onPress={() => {
                                haptic("selection");
                                onSelectHome();
                            }}
                            style={[
                                styles.homeBtn,
                                homeActive && styles.homeBtnActive,
                                homeActive && {
                                    borderColor: colors.border,
                                },
                            ]}
                        >
                            <Ionicons
                                color={homeActive ? colors.text : colors.muted}
                                name="chatbubbles-outline"
                                size={24}
                            />
                            {totalDmUnread > 0 && (
                                <View
                                    style={[
                                        styles.homeBadge,
                                        { backgroundColor: colors.unread },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.homeBadgeText,
                                            { color: colors.unreadText },
                                        ]}
                                    >
                                        {formatUnreadCount(totalDmUnread)}
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        style={styles.serverList}
                    >
                        {serverList.map((server) => {
                            const active = server.serverID === activeServerId;
                            const unread =
                                serverUnreadCounts[server.serverID] ?? 0;
                            return (
                                <View
                                    key={server.serverID}
                                    style={styles.serverRow}
                                >
                                    <View
                                        style={[
                                            styles.activePill,
                                            { backgroundColor: accent.accent },
                                            active && styles.activePillVisible,
                                        ]}
                                    />
                                    <TouchableOpacity
                                        onPress={() => {
                                            haptic("selection");
                                            onSelectServer(server.serverID);
                                        }}
                                        style={[
                                            styles.serverBtn,
                                            active && styles.serverBtnActive,
                                            active && {
                                                borderColor: colors.border,
                                            },
                                        ]}
                                    >
                                        <ServerIcon
                                            iconID={server.icon ?? null}
                                            name={server.name}
                                            serverID={server.serverID}
                                            size={52}
                                        />
                                        {unread > 0 ? (
                                            <View
                                                style={[
                                                    styles.serverBadge,
                                                    {
                                                        backgroundColor:
                                                            colors.unread,
                                                    },
                                                ]}
                                            >
                                                <Text
                                                    style={[
                                                        styles.dmBadgeText,
                                                        {
                                                            color: colors.unreadText,
                                                        },
                                                    ]}
                                                >
                                                    {formatUnreadCount(unread)}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </TouchableOpacity>
                                </View>
                            );
                        })}

                        <View style={styles.serverRow}>
                            <View
                                style={[
                                    styles.activePill,
                                    { backgroundColor: accent.accent },
                                ]}
                            />
                            <TouchableOpacity
                                accessibilityLabel="Create or join a group"
                                accessibilityRole="button"
                                activeOpacity={0.78}
                                onPress={() => {
                                    haptic("tap");
                                    onAddServer();
                                }}
                                style={styles.addBtn}
                            >
                                <Ionicons
                                    color={colors.success}
                                    name="add"
                                    size={26}
                                />
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>

                <View
                    style={[
                        styles.channelPane,
                        { paddingTop: safeAreaTop + 10 },
                    ]}
                >
                    <Text numberOfLines={1} style={styles.channelPaneTitle}>
                        {activeServerId ? currentServerName : "Direct Messages"}
                    </Text>
                    {!activeServerId ? (
                        dmList.length === 0 ? (
                            <Text style={styles.channelPaneEmpty}>
                                No DM conversations yet
                            </Text>
                        ) : (
                            <ScrollView
                                showsVerticalScrollIndicator={false}
                                style={styles.channelList}
                            >
                                {dmList.map((user) => {
                                    const unread =
                                        dmUnreadCounts[user.userID] ?? 0;
                                    const active =
                                        user.userID === activeDmUserId;
                                    return (
                                        <TouchableOpacity
                                            key={user.userID}
                                            onPress={() => {
                                                haptic("selection");
                                                onSelectDM(user);
                                            }}
                                            style={[
                                                styles.channelItem,
                                                active &&
                                                    styles.channelItemActive,
                                            ]}
                                        >
                                            <View style={styles.dmRow}>
                                                <Avatar
                                                    displayName={user.username}
                                                    size={24}
                                                    userID={user.userID}
                                                />
                                                <View style={styles.dmMeta}>
                                                    <View
                                                        style={styles.dmNameRow}
                                                    >
                                                        <Text
                                                            ellipsizeMode="tail"
                                                            numberOfLines={1}
                                                            style={[
                                                                styles.channelItemText,
                                                                styles.dmName,
                                                                active &&
                                                                    styles.channelItemTextActive,
                                                            ]}
                                                        >
                                                            {user.username}
                                                        </Text>
                                                    </View>
                                                </View>
                                                {unread > 0 ? (
                                                    <View
                                                        style={[
                                                            styles.dmBadge,
                                                            {
                                                                backgroundColor:
                                                                    colors.unread,
                                                            },
                                                        ]}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.dmBadgeText,
                                                                {
                                                                    color: colors.unreadText,
                                                                },
                                                            ]}
                                                        >
                                                            {formatUnreadCount(
                                                                unread,
                                                            )}
                                                        </Text>
                                                    </View>
                                                ) : null}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )
                    ) : channels.length === 0 ? (
                        <Text style={styles.channelPaneEmpty}>
                            No channels yet
                        </Text>
                    ) : (
                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            style={styles.channelList}
                        >
                            {channels.map((channel) => {
                                const active =
                                    channel.channelID === activeChannelId;
                                const unread =
                                    channelUnreadCounts[channel.channelID] ?? 0;
                                return (
                                    <TouchableOpacity
                                        key={channel.channelID}
                                        onPress={() => {
                                            haptic("selection");
                                            onSelectChannel(channel);
                                        }}
                                        style={[
                                            styles.channelItem,
                                            active && styles.channelItemActive,
                                        ]}
                                    >
                                        <View style={styles.channelItemRow}>
                                            <Text
                                                numberOfLines={1}
                                                style={[
                                                    styles.channelItemText,
                                                    styles.channelNameText,
                                                    active &&
                                                        styles.channelItemTextActive,
                                                ]}
                                            >
                                                # {channel.name}
                                            </Text>
                                            {unread > 0 ? (
                                                <View
                                                    style={[
                                                        styles.channelBadge,
                                                        {
                                                            backgroundColor:
                                                                colors.unread,
                                                        },
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.dmBadgeText,
                                                            {
                                                                color: colors.unreadText,
                                                            },
                                                        ]}
                                                    >
                                                        {formatUnreadCount(
                                                            unread,
                                                        )}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    )}
                </View>
            </View>

            <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                    haptic("tap");
                    onSettings();
                }}
                style={[
                    styles.profileStrip,
                    { paddingBottom: safeAreaBottom + 12 },
                ]}
            >
                <View style={styles.profileAvatarWrap}>
                    {me?.userID ? (
                        <Avatar
                            displayName={me.username}
                            ring={{
                                color: colors.border,
                                width: 1.5,
                            }}
                            size={42}
                            userID={me.userID}
                        />
                    ) : (
                        <View style={styles.profileAvatarPlaceholder} />
                    )}
                    <View style={authDotStyle} />
                </View>
                <View style={styles.profileText}>
                    <Text
                        ellipsizeMode="tail"
                        numberOfLines={1}
                        style={styles.profileUsername}
                    >
                        {me?.username ?? "Signed out"}
                    </Text>
                    <Text
                        ellipsizeMode="tail"
                        numberOfLines={1}
                        style={styles.profileStatus}
                    >
                        {authStatusLabel}
                    </Text>
                </View>
                <View style={styles.profileGearWrap}>
                    <Ionicons
                        color={colors.muted}
                        name="settings-outline"
                        size={21}
                    />
                </View>
            </TouchableOpacity>
        </View>
    );
}

function formatUnreadCount(count: number): string {
    return count > 99 ? "99+" : count.toString();
}

const styles = StyleSheet.create({
    activePill: {
        borderRadius: 2,
        height: 28,
        opacity: 0,
        width: 4,
    },
    activePillVisible: {
        opacity: 1,
    },
    addBtn: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        height: 56,
        justifyContent: "center",
        marginVertical: 4,
        width: 56,
    },
    authDotAuthenticated: {
        backgroundColor: colors.online,
    },
    authDotChecking: {
        backgroundColor: colors.warning,
    },
    authDotOffline: {
        backgroundColor: colors.offline,
    },
    authDotSignedOut: {
        backgroundColor: colors.mutedDark,
    },
    authDotUnauthorized: {
        backgroundColor: colors.error,
    },
    channelBadge: {
        alignItems: "center",
        borderRadius: 10,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    channelItem: {
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    channelItemActive: {
        backgroundColor: colors.selected,
    },
    channelItemRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
    channelItemText: {
        color: colors.textSecondary,
        fontSize: 13,
    },
    channelItemTextActive: {
        color: colors.text,
        fontWeight: "600",
    },
    channelList: {
        marginTop: 8,
    },
    channelNameText: {
        flex: 1,
        minWidth: 0,
    },
    channelPane: {
        backgroundColor: colors.panel,
        borderLeftColor: colors.borderSubtle,
        borderLeftWidth: 1,
        flex: 1,
        paddingHorizontal: 10,
    },
    channelPaneEmpty: {
        color: colors.mutedDark,
        fontSize: 12,
        marginTop: 8,
    },
    channelPaneTitle: {
        color: colors.text,
        fontSize: 13,
        fontWeight: "600",
    },
    divider: {
        backgroundColor: colors.borderSubtle,
        height: 1,
        marginVertical: 8,
        width: 40,
    },
    dmBadge: {
        alignItems: "center",
        borderRadius: 10,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    dmBadgeText: {
        fontSize: 10,
        fontWeight: "700",
    },
    dmMeta: {
        flex: 1,
        minWidth: 0,
    },
    dmName: {
        flex: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    dmNameRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
    },
    dmRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        justifyContent: "space-between",
    },
    drawerContainer: {
        backgroundColor: colors.rail,
        borderRightColor: colors.borderSubtle,
        borderRightWidth: 1,
        flex: 1,
        flexDirection: "column",
    },
    homeBadge: {
        alignItems: "center",
        borderColor: colors.rail,
        borderRadius: 10,
        borderWidth: 2,
        bottom: -3,
        height: 20,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        position: "absolute",
        right: -3,
    },
    homeBadgeText: {
        fontSize: 10,
        fontWeight: "700",
    },
    homeBtn: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        height: 56,
        justifyContent: "center",
        width: 56,
    },
    homeBtnActive: {
        backgroundColor: colors.selected,
    },
    profileAuthDot: {
        backgroundColor: colors.mutedDark,
        borderColor: colors.rail,
        borderRadius: 999,
        borderWidth: 2,
        bottom: -2,
        height: 14,
        position: "absolute",
        right: -2,
        width: 14,
    },
    profileAvatarPlaceholder: {
        backgroundColor: colors.surfaceLight,
        borderRadius: 21,
        height: 42,
        width: 42,
    },
    profileAvatarWrap: {
        position: "relative",
    },
    profileGearWrap: {
        alignItems: "center",
        height: 24,
        justifyContent: "center",
        width: 24,
    },
    profileStatus: {
        color: colors.mutedDark,
        fontSize: 11,
        marginTop: 1,
        textTransform: "uppercase",
    },
    profileStrip: {
        alignItems: "center",
        backgroundColor: colors.rail,
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    profileText: {
        flex: 1,
        minWidth: 0,
    },
    profileUsername: {
        color: colors.text,
        fontSize: 15,
        fontWeight: "700",
    },
    railContainer: {
        alignItems: "center",
        backgroundColor: colors.rail,
        paddingBottom: 10,
        width: 80,
    },
    serverBadge: {
        alignItems: "center",
        borderColor: colors.rail,
        borderRadius: 10,
        borderWidth: 2,
        bottom: -3,
        height: 20,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        position: "absolute",
        right: -3,
    },
    serverBtn: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 8,
        borderWidth: 1,
        height: 56,
        justifyContent: "center",
        marginVertical: 4,
        width: 56,
    },
    serverBtnActive: {
        backgroundColor: colors.selected,
    },
    serverList: {
        flex: 1,
    },
    serverRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
    topRow: {
        flex: 1,
        flexDirection: "row",
    },
    topSection: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
});
