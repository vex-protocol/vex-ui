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

import { useStore } from "@nanostores/react";

import { haptic } from "../lib/haptics";
import { colors } from "../theme";

import { Avatar } from "./Avatar";
import { VexLogo } from "./VexLogo";

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
                                homeActive && styles.activePillVisible,
                            ]}
                        />
                        <TouchableOpacity
                            onPress={() => {
                                haptic("selection");
                                onSelectHome();
                            }}
                            style={styles.homeBtn}
                        >
                            <VexLogo showWordmark={false} size={22} />
                            {totalDmUnread > 0 && (
                                <View style={styles.homeBadge}>
                                    <Text style={styles.homeBadgeText}>
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
                                        ]}
                                    >
                                        <Text style={styles.serverInitial}>
                                            {server.name
                                                .slice(0, 2)
                                                .toUpperCase()}
                                        </Text>
                                        {unread > 0 ? (
                                            <View style={styles.serverBadge}>
                                                <Text
                                                    style={styles.dmBadgeText}
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
                            <View style={styles.activePill} />
                            <TouchableOpacity
                                onPress={() => {
                                    haptic("tap");
                                    onAddServer();
                                }}
                                style={styles.addBtn}
                            >
                                <Text style={styles.addText}>+</Text>
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
                                                        {unread > 0 ? (
                                                            <View
                                                                style={
                                                                    styles.dmNewDot
                                                                }
                                                            />
                                                        ) : null}
                                                    </View>
                                                </View>
                                                {unread > 0 ? (
                                                    <View
                                                        style={styles.dmBadge}
                                                    >
                                                        <Text
                                                            style={
                                                                styles.dmBadgeText
                                                            }
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
                                                    style={styles.channelBadge}
                                                >
                                                    <Text
                                                        style={
                                                            styles.dmBadgeText
                                                        }
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
                                color: "rgba(231,0,0,0.45)",
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
                    <View style={styles.profileGearOuter}>
                        <View style={styles.profileGearInner} />
                    </View>
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
        backgroundColor: colors.accent,
        height: 22,
        opacity: 0,
        width: 3,
    },
    activePillVisible: {
        opacity: 1,
    },
    addBtn: {
        alignItems: "center",
        backgroundColor: colors.transparent,
        borderColor: colors.border,
        borderStyle: "dashed",
        borderWidth: 1,
        height: 44,
        justifyContent: "center",
        marginVertical: 4,
        width: 44,
    },
    addText: {
        color: colors.success,
        fontSize: 24,
        marginTop: -2,
    },
    authDotAuthenticated: {
        backgroundColor: colors.online,
    },
    authDotChecking: {
        backgroundColor: "#FFD60A",
    },
    authDotOffline: {
        backgroundColor: "#8E8E93",
    },
    authDotSignedOut: {
        backgroundColor: "#6B7280",
    },
    authDotUnauthorized: {
        backgroundColor: "#FF453A",
    },
    channelBadge: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderRadius: 10,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    channelItem: {
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    channelItemActive: {
        backgroundColor: "rgba(231,0,0,0.14)",
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
        color: colors.accentMuted,
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
        backgroundColor: "rgba(9,9,11,0.98)",
        borderLeftColor: "rgba(255,255,255,0.16)",
        borderLeftWidth: 1,
        flex: 1,
        paddingHorizontal: 10,
    },
    channelPaneEmpty: {
        color: "rgba(255,255,255,0.5)",
        fontSize: 12,
        marginTop: 8,
    },
    channelPaneTitle: {
        color: colors.text,
        fontSize: 13,
        fontWeight: "600",
    },
    divider: {
        backgroundColor: "rgba(255,255,255,0.12)",
        height: 1,
        marginVertical: 8,
        width: 40,
    },
    dmBadge: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderRadius: 10,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    dmBadgeText: {
        color: "#fff",
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
    dmNewDot: {
        backgroundColor: colors.accent,
        borderRadius: 999,
        height: 6,
        marginTop: 1,
        width: 6,
    },
    dmRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        justifyContent: "space-between",
    },
    drawerContainer: {
        backgroundColor: "rgba(7,8,12,0.98)",
        borderRightColor: "rgba(255,255,255,0.16)",
        borderRightWidth: 1,
        flex: 1,
        flexDirection: "column",
    },
    homeBadge: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderColor: colors.surface,
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
        color: "#fff",
        fontSize: 10,
        fontWeight: "700",
    },
    homeBtn: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        height: 44,
        justifyContent: "center",
        width: 44,
    },
    profileAuthDot: {
        backgroundColor: "#6B7280",
        borderColor: "#0b0d12",
        borderRadius: 999,
        borderWidth: 2,
        bottom: -2,
        height: 14,
        position: "absolute",
        right: -2,
        width: 14,
    },
    profileAvatarPlaceholder: {
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 21,
        height: 42,
        width: 42,
    },
    profileAvatarWrap: {
        position: "relative",
    },
    profileGearInner: {
        backgroundColor: "rgba(255,255,255,0.55)",
        borderRadius: 6,
        height: 6,
        position: "absolute",
        width: 6,
    },
    profileGearOuter: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.55)",
        borderRadius: 12,
        borderWidth: 2,
        height: 24,
        justifyContent: "center",
        width: 24,
    },
    profileGearWrap: {
        alignItems: "center",
        height: 24,
        justifyContent: "center",
        width: 24,
    },
    profileStatus: {
        color: "rgba(255,255,255,0.55)",
        fontSize: 11,
        letterSpacing: 0.4,
        marginTop: 1,
        textTransform: "uppercase",
    },
    profileStrip: {
        alignItems: "center",
        backgroundColor: "#0e1118",
        borderTopColor: "rgba(231,0,0,0.18)",
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
        letterSpacing: 0.2,
    },
    railContainer: {
        alignItems: "center",
        paddingBottom: 10,
        width: 64,
    },
    serverBadge: {
        alignItems: "center",
        backgroundColor: colors.error,
        borderColor: colors.surface,
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
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        height: 44,
        justifyContent: "center",
        marginVertical: 4,
        width: 44,
    },
    serverBtnActive: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    serverInitial: {
        color: colors.text,
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0.5,
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
