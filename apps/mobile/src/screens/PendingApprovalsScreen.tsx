import type { AppScreenProps } from "../navigation/types";

import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ChatHeader } from "../components/ChatHeader";
import { MenuRow, MenuSection } from "../components/MenuRow";
import { colors } from "../theme";

export function PendingApprovalsScreen({
    navigation,
}: AppScreenProps<"Devices">) {
    return (
        <View style={styles.container}>
            <ChatHeader
                onBack={() => {
                    navigation.goBack();
                }}
                title="Devices"
            />
            <ScrollView contentContainerStyle={styles.content}>
                <MenuSection title="Devices">
                    <MenuRow
                        description="Your signed-in devices"
                        icon="phone-portrait-outline"
                        label="Device Manager"
                        onPress={() => {
                            navigation.navigate("DeviceManager");
                        }}
                    />
                    <MenuRow
                        description="Approve new device sign-ins"
                        icon="shield-checkmark-outline"
                        label="Device Requests"
                        onPress={() => {
                            navigation.navigate("DeviceRequests");
                        }}
                    />
                </MenuSection>

                <MenuSection title="Security">
                    <MenuRow
                        description="Current auth and token details"
                        icon="ribbon-outline"
                        label="Session"
                        onPress={() => {
                            navigation.navigate("SessionDetails");
                        }}
                    />
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
