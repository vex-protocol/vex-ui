import type { RootStackParamList } from "./types";

import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface JoinedServerRouteTarget {
    channelID?: string;
    channelName?: string;
    serverID?: string;
    serverName?: string;
}

export function navigateToAboutSettings(): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        params: { section: "about" },
        screen: "SettingsSection",
    });
}

export function navigateToChannel(
    channelID: string,
    channelName: string,
    serverID: string,
): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        params: { channelID, channelName, serverID },
        screen: "Channel",
    });
}

export function navigateToConversation(userID: string, username: string): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        params: { userID, username },
        screen: "Conversation",
    });
}

export function navigateToDeviceRequests(): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        screen: "DeviceRequests",
    });
}

export function navigateToDevices(): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        screen: "Devices",
    });
}

export function navigateToDMList(): void {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("App", {
        screen: "DMList",
    });
}

export function navigateToJoinedServer(
    target: JoinedServerRouteTarget,
): boolean {
    if (!navigationRef.isReady() || !target.serverID) return false;
    if (target.channelID && target.channelName) {
        navigationRef.navigate("App", {
            params: {
                channelID: target.channelID,
                channelName: target.channelName,
                serverID: target.serverID,
            },
            screen: "Channel",
        });
        return true;
    }
    navigationRef.navigate("App", {
        params: {
            serverID: target.serverID,
            ...(target.serverName ? { serverName: target.serverName } : {}),
        },
        screen: "ChannelList",
    });
    return true;
}
