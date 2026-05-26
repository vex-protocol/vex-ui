import type { AppScreenProps } from "../navigation/types";
import type { Ionicons } from "@expo/vector-icons";

import React from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";

import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { $appUpdateState } from "../lib/appUpdates";
import { $devOptionsUnlocked } from "../lib/devMode";
import { isAlwaysOnSupported } from "../lib/foregroundService";
import { colors } from "../theme";

interface SettingsRow {
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
}

export function SettingsScreen({ navigation }: AppScreenProps<"Settings">) {
    const devUnlocked = useStore($devOptionsUnlocked);
    const appUpdateState = useStore($appUpdateState);
    const aboutDescription =
        appUpdateState.status === "ota_available"
            ? "OTA update available"
            : appUpdateState.status === "ota_ready"
              ? "Restart to apply update"
              : appUpdateState.status === "apk_available"
                ? Platform.OS === "ios"
                    ? "Build update available"
                    : "APK update available"
                : "Version and updates";
    const accountRows: ReadonlyArray<SettingsRow> = [
        {
            description: "Profile, identity, sign out",
            icon: "person-circle-outline",
            label: "Account",
            onPress: () => {
                navigation.navigate("SettingsSection", { section: "account" });
            },
        },
        {
            description: "Manage your devices",
            icon: "phone-portrait-outline",
            label: "Devices",
            onPress: () => {
                navigation.navigate("Devices");
            },
        },
        {
            description:
                "Recover and manage your account if you lose every device",
            icon: "key-outline",
            label: "Passkeys",
            onPress: () => {
                navigation.navigate("Passkeys");
            },
        },
    ];

    const systemRows: ReadonlyArray<SettingsRow> = [
        // Foreground-service toggle is Android-only — iOS strictly
        // suspends backgrounded apps and there's no equivalent surface.
        ...(isAlwaysOnSupported() && Platform.OS === "android"
            ? [
                  {
                      description:
                          "Keep receiving messages while in background",
                      icon: "wifi-outline" as const,
                      label: "Connection",
                      onPress: () => {
                          navigation.navigate("SettingsSection", {
                              section: "connection",
                          });
                      },
                  },
              ]
            : []),
        {
            description: "Push alerts for new messages",
            icon: "notifications-outline",
            label: "Notifications",
            onPress: () => {
                navigation.navigate("SettingsSection", {
                    section: "notifications",
                });
            },
        },
        {
            description: "Unread badges and storage",
            icon: "folder-open-outline",
            label: "Data",
            onPress: () => {
                navigation.navigate("SettingsSection", { section: "data" });
            },
        },
        // Developer surface stays hidden until the user unlocks it via
        // the easter egg (7 taps on the version row in About).
        ...(devUnlocked
            ? [
                  {
                      description: "Connection diagnostics",
                      icon: "code-slash-outline" as const,
                      label: "Developer",
                      onPress: () => {
                          navigation.navigate("SettingsSection", {
                              section: "developer",
                          });
                      },
                  },
              ]
            : []),
        {
            description: aboutDescription,
            icon: "information-circle-outline",
            label: "About",
            onPress: () => {
                navigation.navigate("SettingsSection", { section: "about" });
            },
        },
    ];

    return (
        <View style={styles.container}>
            <ChatHeader title="Settings" />
            <ScrollView contentContainerStyle={styles.content}>
                <MenuSection title="Account">
                    {accountRows.map((row) => (
                        <MenuRow
                            description={row.description}
                            icon={row.icon}
                            key={row.label}
                            label={row.label}
                            onPress={row.onPress}
                        />
                    ))}
                </MenuSection>
                <MenuSection title="System">
                    {systemRows.map((row) => (
                        <MenuRow
                            description={row.description}
                            icon={row.icon}
                            key={row.label}
                            label={row.label}
                            onPress={row.onPress}
                        />
                    ))}
                </MenuSection>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        gap: 18,
        paddingBottom: 24,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
});
