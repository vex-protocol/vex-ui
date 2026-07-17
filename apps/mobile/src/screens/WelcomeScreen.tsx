import type { AuthScreenProps } from "../navigation/types";

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { colors, typography, useAccentColors } from "../theme";

type Props = AuthScreenProps<"Welcome">;

export function WelcomeScreen({ navigation }: Props) {
    const accent = useAccentColors();
    return (
        <ScreenLayout paddingHorizontal={28} style={styles.layout}>
            <View style={styles.container}>
                <View style={styles.logoWrap}>
                    <VexLogo size={42} />
                </View>

                <View style={styles.actions}>
                    <VexButton
                        onPress={() => {
                            navigation.navigate("HangTight", {
                                force: true,
                                mode: "signin",
                            });
                        }}
                        style={styles.actionButton}
                        title="Sign in"
                        variant="primary"
                    />
                    <VexButton
                        onPress={() => {
                            navigation.navigate("HangTight", {
                                force: true,
                                mode: "signup",
                            });
                        }}
                        style={styles.actionButton}
                        title="Create account"
                        variant="outline"
                    />
                </View>

                <Text style={styles.footer}>
                    <Text
                        style={[
                            styles.footerLink,
                            { color: accent.accentText },
                        ]}
                    >
                        Privacy Policy
                    </Text>
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
        letterSpacing: 0,
        lineHeight: 16,
        marginTop: 26,
        textAlign: "center",
        textTransform: "uppercase",
    },
    footerLink: {
        textDecorationLine: "underline",
    },
    layout: {
        backgroundColor: colors.bg,
    },
    logoWrap: {
        marginBottom: 26,
    },
});
