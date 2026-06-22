import type { AuthScreenProps } from "../navigation/types";

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { colors, typography } from "../theme";

type Props = AuthScreenProps<"Welcome">;

export function WelcomeScreen({ navigation }: Props) {
    return (
        <ScreenLayout paddingHorizontal={28} style={styles.layout}>
            <View style={styles.container}>
                <View pointerEvents="none" style={styles.blackoutLayer} />
                <View pointerEvents="none" style={styles.glowTop} />
                <View pointerEvents="none" style={styles.glowBottom} />

                <View style={styles.logoWrap}>
                    <VexLogo size={42} />
                </View>

                <View style={styles.actions}>
                    <VexButton
                        glow
                        onPress={() => {
                            navigation.navigate("HangTight", { force: true });
                        }}
                        style={styles.actionButton}
                        title="Sign in"
                        variant="primary"
                    />
                </View>

                <Text style={styles.footer}>
                    <Text style={styles.footerLink}>Privacy Policy</Text>
                </Text>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    actionButton: {
        width: "100%",
    },
    actions: {
        alignItems: "center",
        gap: 12,
        paddingTop: 6,
        width: "100%",
    },
    blackoutLayer: {
        ...StyleSheet.absoluteFill,
        backgroundColor: "#000000",
        opacity: 0.72,
    },
    container: {
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        paddingBottom: 22,
    },
    footer: {
        ...typography.body,
        color: "rgba(255,255,255,0.48)",
        fontSize: 11,
        letterSpacing: 0.9,
        lineHeight: 16,
        marginTop: 26,
        textAlign: "center",
        textTransform: "uppercase",
    },
    footerLink: {
        color: colors.accent,
        textDecorationLine: "underline",
    },
    glowBottom: {
        backgroundColor: colors.accent,
        borderRadius: 120,
        bottom: -40,
        height: 140,
        left: "30%",
        opacity: 0.08,
        position: "absolute",
        width: 140,
    },
    glowTop: {
        backgroundColor: colors.accent,
        borderRadius: 140,
        height: 160,
        opacity: 0.1,
        position: "absolute",
        right: -44,
        top: -48,
        width: 160,
    },
    layout: {
        backgroundColor: "#000000",
    },
    logoWrap: {
        marginBottom: 26,
    },
});
