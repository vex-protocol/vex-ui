import type { AppScreenProps } from "../navigation/types";
import type { Channel } from "@vex-chat/libvex";

import React from "react";
import {
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { $channels, $servers } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { VexField } from "../components/VexField";
import { colors, fontFamilies, typography } from "../theme";

export function ChannelListScreen({
    navigation,
    route,
}: AppScreenProps<"ChannelList">) {
    const { serverID } = route.params;
    const allChannels = useStore($channels);
    const servers = useStore($servers);
    const channels: Channel[] = allChannels[serverID] ?? [];
    const serverName =
        servers[serverID]?.name ?? route.params.serverName ?? "Server";

    function renderChannel({ item }: { item: Channel }) {
        return (
            <TouchableOpacity
                onPress={() => {
                    navigation.navigate("Channel", {
                        channelID: item.channelID,
                        channelName: item.name,
                        serverID,
                    });
                }}
                style={styles.row}
            >
                <Text style={styles.hash}>#</Text>
                <Text style={styles.name}>{item.name}</Text>
            </TouchableOpacity>
        );
    }

    return (
        <VexField style={styles.container}>
            <ChatHeader
                onOverflow={() => {
                    navigation.navigate("ServerSettings", {
                        serverID,
                        serverName,
                    });
                }}
                title={serverName}
            />

            {channels.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>No channels</Text>
                </View>
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    data={channels}
                    keyExtractor={(c) => c.channelID}
                    renderItem={renderChannel}
                />
            )}
        </VexField>
    );
}

const styles = StyleSheet.create({
    container: { backgroundColor: colors.bg, flex: 1 },
    empty: { alignItems: "center", flex: 1, justifyContent: "center" },
    emptyText: { ...typography.body, color: colors.muted, fontStyle: "italic" },
    hash: {
        color: colors.mutedDark,
        fontFamily: fontFamilies.mono,
        fontSize: 14,
        width: 12,
    },
    list: {
        paddingHorizontal: 6,
        paddingTop: 10,
    },
    name: { ...typography.body, color: colors.muted, flex: 1, fontSize: 14 },
    row: {
        alignItems: "center",
        backgroundColor: colors.surfaceLight,
        borderColor: colors.borderSubtle,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
});
