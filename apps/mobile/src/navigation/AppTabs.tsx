import type { AppStackParamList } from "./types";

import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import { $authStatus, $channels, $familiars, $servers } from "@vex-chat/store";

import { useStore } from "@nanostores/react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ServerSidebar } from "../components/ServerSidebar";
import { haptic } from "../lib/haptics";
import { $leftSidebarOpen, $rightSidebarOpen } from "../lib/sidebarState";
import { AddServerScreen } from "../screens/AddServerScreen";
import { AppearanceScreen } from "../screens/AppearanceScreen";
import { AvatarCropScreen } from "../screens/AvatarCropScreen";
import { CameraCaptureScreen } from "../screens/CameraCaptureScreen";
import { ChannelListScreen } from "../screens/ChannelListScreen";
import { ChannelScreen } from "../screens/ChannelScreen";
import { ConversationScreen } from "../screens/ConversationScreen";
import { DeviceDetailsScreen } from "../screens/DeviceDetailsScreen";
import { DeviceManagerScreen } from "../screens/DeviceManagerScreen";
import { DeviceRequestsScreen } from "../screens/DeviceRequestsScreen";
import { DMListScreen } from "../screens/DMListScreen";
import { InvitePreviewScreen } from "../screens/InvitePreviewScreen";
import { InviteScreen } from "../screens/InviteScreen";
import { JoinGroupScreen } from "../screens/JoinGroupScreen";
import { OnboardingEmptyScreen } from "../screens/OnboardingEmptyScreen";
import { PasskeysScreen } from "../screens/PasskeysScreen";
import { PasswordScreen } from "../screens/PasswordScreen";
import { PendingApprovalsScreen } from "../screens/PendingApprovalsScreen";
import { ServerSettingsScreen } from "../screens/ServerSettingsScreen";
import { SessionDetailsScreen } from "../screens/SessionDetailsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SettingsSectionScreen } from "../screens/SettingsSectionScreen";
import { ShareComposerScreen } from "../screens/ShareComposerScreen";
import { colors } from "../theme";

import { navigationRef } from "./navigationRef";

const Stack = createNativeStackNavigator<AppStackParamList>();
const SIDEBAR_WIDTH = 288;
// "Machined slot-in" feel: aggressive ease-out so the drawer
// decelerates into place without bounce. Cubic-bezier modeled on
// Material's "decelerate emphasized" curve (fast in, hard land).
const SIDEBAR_OPEN_DURATION_MS = 240;
const SIDEBAR_CLOSE_DURATION_MS = 180;
const SIDEBAR_OPEN_EASING = Easing.bezier(0.2, 0.0, 0.0, 1.0);
const SIDEBAR_CLOSE_EASING = Easing.bezier(0.4, 0.0, 0.2, 1.0);
// "click ... CLICK" pair interval. Decoupled from the animation
// duration — the haptic should feel like a precision detent
// snapping into place, which means the second tick wants to land
// noticeably faster than the visual settle. ~95ms is right at the
// edge of "two distinct events" vs. "one chunky thud".
const SIDEBAR_SLOT_HAPTIC_INTERVAL_MS = 95;
const TOP_LEFT_BACK_ROUTES: ReadonlyArray<keyof AppStackParamList> = [
    "AddServer",
    "Appearance",
    "AvatarCrop",
    "CameraCapture",
    "DeviceDetails",
    "DeviceManager",
    "DeviceRequests",
    "Devices",
    "Invite",
    "InvitePreview",
    "JoinGroup",
    "Passkeys",
    "Password",
    "ServerSettings",
    "SessionDetails",
    "Settings",
    "SettingsSection",
    "ShareComposer",
] as const;
const CHAT_ROUTES: ReadonlyArray<keyof AppStackParamList> = [
    "Channel",
    "Conversation",
] as const;

export function AppTabs() {
    const insets = useSafeAreaInsets();
    const [activeServerId, setActiveServerId] = useState<null | string>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const channels = useStore($channels);
    const familiars = useStore($familiars);
    const servers = useStore($servers);
    const authStatus = useStore($authStatus);
    const initialRoute: keyof AppStackParamList = "DMList";
    const [currentRoute, setCurrentRoute] =
        useState<keyof AppStackParamList>(initialRoute);
    const [activeChannelId, setActiveChannelId] = useState<null | string>(null);
    const [activeDmUserId, setActiveDmUserId] = useState<null | string>(null);
    // Per-server "most recently visited channel" map. Tapping a server
    // icon snaps to its last-opened channel (falling back to the first
    // channel, or the channel list if the server has none).
    //
    // We keep this as a plain object in component state — short-lived
    // and per-session is fine, since the ServerSidebar is mounted for
    // the entire authenticated app lifetime.
    const [lastChannelByServer, setLastChannelByServer] = useState<
        Record<string, string>
    >({});
    // Most recently visited DM userID. Symmetric with `lastChannelByServer`
    // but flat — DMs aren't grouped by anything, so a single slot is
    // enough. Tapping the home rail icon (or the top-left back-to-DMs
    // chevron) snaps to this DM if the user is still a known familiar,
    // otherwise we fall back to the DM list hub.
    const [lastDmUserId, setLastDmUserId] = useState<null | string>(null);
    // Which server's channels the *channel pane* is currently
    // displaying. This diverges from `activeServerId` (the routed
    // server) while the user is "peeking" at another server's channels
    // without committing to navigate there. Null = DM pane.
    //
    // Tap rules:
    //   - tap a server whose channels are *not* currently in the pane
    //     → swap the pane to that server's channels (no nav, drawer
    //     stays open).
    //   - tap the server whose channels are *already* in the pane
    //     → navigate to that server's last/first channel + close
    //     drawer.
    //
    // The pane re-syncs to `activeServerId` every time the drawer
    // opens, so reopening always starts from "show the server I'm
    // currently in".
    const [paneServerId, setPaneServerId] = useState<null | string>(null);
    const rightSidebarOpen = useStore($rightSidebarOpen);
    const topLeftHidden = currentRoute === "CameraCapture";
    const topLeftShowsBack = TOP_LEFT_BACK_ROUTES.includes(currentRoute);
    const isChatRoute = CHAT_ROUTES.includes(currentRoute);
    const sidebarX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
    const backdropOpacity = sidebarX.interpolate({
        inputRange: [-SIDEBAR_WIDTH, 0],
        outputRange: [0, 0.5],
    });
    const toggleX = sidebarX.interpolate({
        inputRange: [-SIDEBAR_WIDTH, 0],
        outputRange: [8, SIDEBAR_WIDTH + 8],
    });

    // Pending haptic timer for the "click ... CLICK" pair tied to the
    // sidebar slide. We hold the cancel function so an interrupted
    // animation doesn't fire a stale landing tick.
    const sidebarLandingHapticRef = useRef<(() => void) | null>(null);
    const cancelPendingSidebarHaptic = () => {
        if (sidebarLandingHapticRef.current) {
            sidebarLandingHapticRef.current();
            sidebarLandingHapticRef.current = null;
        }
    };

    const openSidebar = () => {
        $rightSidebarOpen.set(false);
        $leftSidebarOpen.set(true);
        setSidebarOpen(true);
        // Always resync the channel pane to the routed server when the
        // drawer opens — the user's "current location" is the natural
        // starting point. Subsequent server taps can diverge it (peek)
        // until the drawer is closed and reopened.
        setPaneServerId(activeServerId);
        cancelPendingSidebarHaptic();
        // Click on motion start, CLICK as it lands. Drawer snaps into
        // place rather than bouncing — paired with the timing curve
        // below to feel like a machined part slotting in.
        haptic("slotIn");
        sidebarLandingHapticRef.current = haptic.scheduled(
            "slotOut",
            SIDEBAR_SLOT_HAPTIC_INTERVAL_MS,
        );
        Animated.timing(sidebarX, {
            duration: SIDEBAR_OPEN_DURATION_MS,
            easing: SIDEBAR_OPEN_EASING,
            toValue: 0,
            useNativeDriver: true,
        }).start();
    };

    const closeSidebar = () => {
        $leftSidebarOpen.set(false);
        cancelPendingSidebarHaptic();
        haptic("slotIn");
        sidebarLandingHapticRef.current = haptic.scheduled(
            "slotOut",
            SIDEBAR_SLOT_HAPTIC_INTERVAL_MS,
        );
        Animated.timing(sidebarX, {
            duration: SIDEBAR_CLOSE_DURATION_MS,
            easing: SIDEBAR_CLOSE_EASING,
            toValue: -SIDEBAR_WIDTH,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                setSidebarOpen(false);
            }
        });
    };
    const toggleSidebar = () => {
        if (sidebarOpen) {
            closeSidebar();
            return;
        }
        openSidebar();
    };

    useEffect(() => {
        if (rightSidebarOpen && sidebarOpen) {
            closeSidebar();
        }
    }, [rightSidebarOpen, sidebarOpen]);

    // Resolve "where home should land" — the last visited DM if we
    // still know the familiar, otherwise the DM list hub. Returns the
    // navigation action to dispatch *and* an optional userID to seed
    // activeDmUserId so the rail's selection state matches before the
    // route lands.
    const navigateHome = () => {
        const target = lastDmUserId ? familiars[lastDmUserId] : undefined;
        if (target) {
            setActiveDmUserId(target.userID);
            navigationRef.navigate("App", {
                params: {
                    userID: target.userID,
                    username: target.username,
                },
                screen: "Conversation",
            });
            return;
        }
        setActiveDmUserId(null);
        navigationRef.navigate("App", {
            screen: "DMList",
        });
    };
    const handleTopLeftPress = () => {
        if (topLeftShowsBack) {
            // Back-button context: closeSidebar() already does its own
            // click+CLICK pair if the drawer happens to be open, so we
            // only need to add a light tap for the back-nav itself.
            haptic("tap");
            if (sidebarOpen) {
                closeSidebar();
            }
            if (currentRoute === "Conversation") {
                // Back from a DM lands on the list hub so the user can
                // pick a different conversation — this is the one
                // place we deliberately *don't* honor lastDmUserId.
                navigationRef.navigate("App", {
                    screen: "DMList",
                });
                return;
            }
            if (navigationRef.canGoBack()) {
                navigationRef.goBack();
                return;
            }
            navigateHome();
            return;
        }
        // openSidebar / closeSidebar already fire their own slot
        // haptic — let the drawer toggle do the talking.
        toggleSidebar();
    };

    return (
        <View style={styles.container}>
            <View
                style={[
                    styles.content,
                    {
                        paddingBottom: isChatRoute ? 0 : insets.bottom,
                        paddingTop: insets.top,
                    },
                ]}
            >
                <ContentStack
                    initialRoute={initialRoute}
                    onRouteChange={(route, params) => {
                        setCurrentRoute(route);
                        if (
                            route === "Channel" ||
                            route === "ChannelList" ||
                            route === "Invite" ||
                            route === "ServerSettings"
                        ) {
                            const serverID =
                                params &&
                                typeof params === "object" &&
                                "serverID" in params &&
                                typeof params.serverID === "string"
                                    ? params.serverID
                                    : null;
                            setActiveServerId(serverID);
                        } else if (
                            route === "DMList" ||
                            route === "Conversation"
                        ) {
                            setActiveServerId(null);
                        }
                        if (route === "Channel") {
                            const channelID =
                                params &&
                                typeof params === "object" &&
                                "channelID" in params &&
                                typeof params.channelID === "string"
                                    ? params.channelID
                                    : null;
                            const serverIDFromChannel =
                                params &&
                                typeof params === "object" &&
                                "serverID" in params &&
                                typeof params.serverID === "string"
                                    ? params.serverID
                                    : null;
                            setActiveChannelId(channelID);
                            // Remember this as the server's last-visited
                            // channel so a subsequent server-icon tap snaps
                            // back here instead of the first channel.
                            if (serverIDFromChannel && channelID) {
                                setLastChannelByServer((prev) =>
                                    prev[serverIDFromChannel] === channelID
                                        ? prev
                                        : {
                                              ...prev,
                                              [serverIDFromChannel]: channelID,
                                          },
                                );
                            }
                        } else {
                            setActiveChannelId(null);
                        }
                        if (route === "Conversation") {
                            const userID =
                                params &&
                                typeof params === "object" &&
                                "userID" in params &&
                                typeof params.userID === "string"
                                    ? params.userID
                                    : null;
                            setActiveDmUserId(userID);
                            // Remember this as the most recent DM so a
                            // subsequent home-rail tap (or back chevron
                            // from a server view) snaps back here
                            // instead of dumping the user on DMList.
                            if (userID) {
                                setLastDmUserId(userID);
                            }
                        } else {
                            setActiveDmUserId(null);
                        }
                    }}
                />
            </View>

            {topLeftHidden ? null : (
                <Animated.View
                    style={[
                        styles.toggleButtonWrap,
                        {
                            top: insets.top + 10,
                            transform: [{ translateX: toggleX }],
                        },
                    ]}
                >
                    <View
                        style={[
                            styles.toggleButtonFrame,
                            sidebarOpen
                                ? styles.toggleButtonFrameOpen
                                : styles.toggleButtonFrameClosed,
                        ]}
                    >
                        <Pressable
                            onPress={handleTopLeftPress}
                            style={styles.hamburgerButton}
                        >
                            {topLeftShowsBack ? (
                                <>
                                    <View
                                        style={[
                                            styles.chevronBar,
                                            styles.backBarTop,
                                        ]}
                                    />
                                    <View
                                        style={[
                                            styles.chevronBar,
                                            styles.backBarBottom,
                                        ]}
                                    />
                                </>
                            ) : sidebarOpen ? (
                                <>
                                    <View
                                        style={[
                                            styles.chevronBar,
                                            styles.chevronBarTop,
                                        ]}
                                    />
                                    <View
                                        style={[
                                            styles.chevronBar,
                                            styles.chevronBarBottom,
                                        ]}
                                    />
                                </>
                            ) : (
                                <>
                                    <View style={styles.hamburgerLine} />
                                    <View style={styles.hamburgerLine} />
                                    <View style={styles.hamburgerLine} />
                                </>
                            )}
                        </Pressable>
                    </View>
                </Animated.View>
            )}

            {sidebarOpen && (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.backdrop,
                        {
                            bottom: -insets.bottom,
                            opacity: backdropOpacity,
                            top: -insets.top,
                        },
                    ]}
                />
            )}
            {sidebarOpen && (
                <Pressable
                    onPress={closeSidebar}
                    style={[
                        styles.backdropPressable,
                        { bottom: -insets.bottom, top: -insets.top },
                    ]}
                />
            )}

            <Animated.View
                style={[
                    styles.sidebarDrawer,
                    {
                        bottom: -insets.bottom,
                        paddingBottom: insets.bottom,
                        paddingTop: insets.top,
                        top: -insets.top,
                        transform: [{ translateX: sidebarX }],
                    },
                ]}
            >
                {/**
                 * Channel pane shows channels for the currently active server.
                 */}
                <ServerSidebar
                    activeChannelId={activeChannelId}
                    activeDmUserId={activeDmUserId}
                    activeServerId={paneServerId}
                    authStatus={authStatus}
                    channels={
                        paneServerId ? (channels[paneServerId] ?? []) : []
                    }
                    currentServerName={
                        paneServerId
                            ? (servers[paneServerId]?.name ?? "Server")
                            : ""
                    }
                    onAddServer={() => {
                        closeSidebar();
                        navigationRef.navigate("App", {
                            screen: "AddServer",
                        });
                    }}
                    onSelectChannel={(channel) => {
                        if (!paneServerId) {
                            return;
                        }
                        closeSidebar();
                        setActiveChannelId(channel.channelID);
                        navigationRef.navigate("App", {
                            params: {
                                channelID: channel.channelID,
                                channelName: channel.name,
                                serverID: paneServerId,
                            },
                            screen: "Channel",
                        });
                    }}
                    onSelectDM={(user) => {
                        closeSidebar();
                        setActiveDmUserId(user.userID);
                        navigationRef.navigate("App", {
                            params: {
                                userID: user.userID,
                                username: user.username,
                            },
                            screen: "Conversation",
                        });
                    }}
                    onSelectHome={() => {
                        if (paneServerId !== null) {
                            setPaneServerId(null);
                            setActiveServerId(null);
                            navigateHome();
                        }
                        closeSidebar();
                    }}
                    onSelectServer={(id) => {
                        if (id === paneServerId) {
                            closeSidebar();
                            return;
                        }
                        setPaneServerId(id);
                        const serverChannels = channels[id] ?? [];
                        const lastChannelID = lastChannelByServer[id];
                        const lastChannel = lastChannelID
                            ? serverChannels.find(
                                  (c) => c.channelID === lastChannelID,
                              )
                            : undefined;
                        const target = lastChannel ?? serverChannels[0];
                        setActiveServerId(id);
                        if (target) {
                            navigationRef.navigate("App", {
                                params: {
                                    channelID: target.channelID,
                                    channelName: target.name,
                                    serverID: id,
                                },
                                screen: "Channel",
                            });
                            setActiveChannelId(target.channelID);
                        } else {
                            navigationRef.navigate("App", {
                                params: { serverID: id },
                                screen: "ChannelList",
                            });
                            setActiveChannelId(null);
                        }
                        closeSidebar();
                    }}
                    onSettings={() => {
                        closeSidebar();
                        navigationRef.navigate("App", {
                            screen: "Settings",
                        });
                    }}
                    safeAreaBottom={insets.bottom}
                    safeAreaTop={insets.top}
                />
            </Animated.View>
        </View>
    );
}

function ContentStack({
    initialRoute,
    onRouteChange,
}: {
    initialRoute: keyof AppStackParamList;
    onRouteChange: (
        route: keyof AppStackParamList,
        params?: AppStackParamList[keyof AppStackParamList],
    ) => void;
}) {
    const withFocus =
        (name: keyof AppStackParamList) =>
        ({ route }: { route: { params?: unknown } }) => ({
            focus: () => {
                onRouteChange(
                    name,
                    route.params as AppStackParamList[keyof AppStackParamList],
                );
            },
        });

    return (
        <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{ headerShown: false }}
        >
            <Stack.Screen
                component={OnboardingEmptyScreen}
                listeners={withFocus("OnboardingEmpty")}
                name="OnboardingEmpty"
            />
            <Stack.Screen
                component={JoinGroupScreen}
                listeners={withFocus("JoinGroup")}
                name="JoinGroup"
            />
            <Stack.Screen
                component={AddServerScreen}
                listeners={withFocus("AddServer")}
                name="AddServer"
            />
            <Stack.Screen
                component={DMListScreen}
                listeners={withFocus("DMList")}
                name="DMList"
            />
            <Stack.Screen
                component={ShareComposerScreen}
                listeners={withFocus("ShareComposer")}
                name="ShareComposer"
            />
            <Stack.Screen
                component={ConversationScreen}
                listeners={withFocus("Conversation")}
                name="Conversation"
            />
            <Stack.Screen
                component={ChannelListScreen}
                listeners={withFocus("ChannelList")}
                name="ChannelList"
            />
            <Stack.Screen
                component={ChannelScreen}
                listeners={withFocus("Channel")}
                name="Channel"
            />
            <Stack.Screen
                component={InviteScreen}
                listeners={withFocus("Invite")}
                name="Invite"
            />
            <Stack.Screen
                component={InvitePreviewScreen}
                listeners={withFocus("InvitePreview")}
                name="InvitePreview"
            />
            <Stack.Screen
                component={ServerSettingsScreen}
                listeners={withFocus("ServerSettings")}
                name="ServerSettings"
            />
            <Stack.Screen
                component={SettingsScreen}
                listeners={withFocus("Settings")}
                name="Settings"
            />
            <Stack.Screen
                component={AppearanceScreen}
                listeners={withFocus("Appearance")}
                name="Appearance"
            />
            <Stack.Screen
                component={SettingsSectionScreen}
                listeners={withFocus("SettingsSection")}
                name="SettingsSection"
            />
            <Stack.Screen
                component={AvatarCropScreen}
                listeners={withFocus("AvatarCrop")}
                name="AvatarCrop"
                options={{ presentation: "modal" }}
            />
            <Stack.Screen
                component={CameraCaptureScreen}
                listeners={withFocus("CameraCapture")}
                name="CameraCapture"
                options={{ presentation: "modal" }}
            />
            <Stack.Screen
                component={PendingApprovalsScreen}
                listeners={withFocus("Devices")}
                name="Devices"
            />
            <Stack.Screen
                component={DeviceManagerScreen}
                listeners={withFocus("DeviceManager")}
                name="DeviceManager"
            />
            <Stack.Screen
                component={DeviceRequestsScreen}
                listeners={withFocus("DeviceRequests")}
                name="DeviceRequests"
            />
            <Stack.Screen
                component={DeviceDetailsScreen}
                listeners={withFocus("DeviceDetails")}
                name="DeviceDetails"
            />
            <Stack.Screen
                component={SessionDetailsScreen}
                listeners={withFocus("SessionDetails")}
                name="SessionDetails"
            />
            <Stack.Screen
                component={PasskeysScreen}
                listeners={withFocus("Passkeys")}
                name="Passkeys"
            />
            <Stack.Screen
                component={PasswordScreen}
                listeners={withFocus("Password")}
                name="Password"
            />
        </Stack.Navigator>
    );
}

const styles = StyleSheet.create({
    backBarBottom: {
        transform: [
            { rotate: "-45deg" },
            { translateX: 1.3 },
            { translateY: -3.1 },
        ],
    },
    backBarTop: {
        transform: [
            { rotate: "45deg" },
            { translateX: 1.3 },
            { translateY: 3.1 },
        ],
    },
    backdrop: {
        backgroundColor: colors.overlay,
        left: 0,
        position: "absolute",
        right: 0,
    },
    backdropPressable: {
        left: 0,
        position: "absolute",
        right: 0,
    },
    chevronBar: {
        backgroundColor: colors.text,
        borderRadius: 999,
        height: 2,
        position: "absolute",
        width: 11,
    },
    chevronBarBottom: {
        transform: [
            { rotate: "45deg" },
            { translateX: -1.3 },
            { translateY: -3.1 },
        ],
    },
    chevronBarTop: {
        transform: [
            { rotate: "-45deg" },
            { translateX: -1.3 },
            { translateY: 3.1 },
        ],
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    hamburgerButton: {
        alignItems: "center",
        flex: 1,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    hamburgerLine: {
        backgroundColor: colors.text,
        borderRadius: 999,
        height: 2,
        marginVertical: 1.5,
        width: 14,
    },
    sidebarDrawer: {
        backgroundColor: colors.rail,
        left: 0,
        position: "absolute",
        top: 0,
        width: SIDEBAR_WIDTH,
    },
    toggleButtonFrame: {
        borderRadius: 12,
        height: 36,
        overflow: "hidden",
        width: 36,
    },
    toggleButtonFrameClosed: {
        backgroundColor: colors.panel,
        borderColor: colors.border,
        borderWidth: 1,
    },
    toggleButtonFrameOpen: {
        backgroundColor: colors.rail,
        borderColor: colors.border,
        borderWidth: 1,
    },
    toggleButtonWrap: {
        left: 0,
        position: "absolute",
        zIndex: 40,
    },
});
