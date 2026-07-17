import type { AppStackParamList } from "../navigation/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useNavigation } from "@react-navigation/native";

import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { colors, typography, useAccentColors } from "../theme";

export function OnboardingEmptyScreen() {
    const accent = useAccentColors();
    const navigation =
        useNavigation<
            NativeStackNavigationProp<AppStackParamList, "OnboardingEmpty">
        >();

    return (
        <ScreenLayout glows>
            <View style={styles.body}>
                <View style={styles.hero}>
                    <Text style={[styles.kicker, { color: accent.accentText }]}>
                        NEW ACCOUNT
                    </Text>
                    <Text style={styles.heading}>Welcome to Vex</Text>
                    <Text style={styles.subtitle}>
                        You are all set, but there is nothing to show yet.
                        {"\n"}Create a group or join one with an invite code.
                    </Text>
                </View>

                <View style={styles.actions}>
                    <VexButton
                        glow
                        icon="add"
                        onPress={() => {
                            navigation.navigate("AddServer");
                        }}
                        title="Create your first group"
                    />
                    <VexButton
                        icon="link-outline"
                        onPress={() => {
                            navigation.navigate("JoinGroup");
                        }}
                        title="Join with invite code"
                        variant="outline"
                    />
                    <TouchableOpacity
                        onPress={() => {
                            navigation.navigate("DMList");
                        }}
                        style={styles.secondaryLink}
                    >
                        <Text style={styles.secondaryLinkText}>
                            Find a user by username
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    actions: {
        gap: 12,
        marginTop: 28,
    },
    body: {
        flex: 1,
        justifyContent: "flex-start",
        paddingTop: 24,
    },
    heading: {
        ...typography.headingSmall,
        color: colors.text,
    },
    hero: {
        alignItems: "center",
        gap: 10,
        marginTop: 8,
    },
    kicker: {
        ...typography.label,
        letterSpacing: 0,
    },
    secondaryLink: {
        alignItems: "center",
        paddingVertical: 8,
    },
    secondaryLinkText: {
        ...typography.body,
        color: colors.muted,
        textDecorationLine: "underline",
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        maxWidth: 300,
        textAlign: "center",
    },
});
