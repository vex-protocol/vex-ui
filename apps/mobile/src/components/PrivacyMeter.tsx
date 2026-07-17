import React from "react";
import { StyleSheet, View } from "react-native";

import { colors, useAccentColors } from "../theme";

interface PrivacyMeterProps {
    level: 1 | 2 | 3 | 4;
}

export function PrivacyMeter({ level }: PrivacyMeterProps) {
    const accent = useAccentColors();
    return (
        <View style={styles.container}>
            {[1, 2, 3, 4].map((i) => (
                <View
                    key={i}
                    style={[
                        styles.bar,
                        i <= level
                            ? { backgroundColor: accent.accent }
                            : styles.unfilled,
                    ]}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        borderRadius: 1,
        height: 14,
        width: 8,
    },
    container: {
        alignItems: "center",
        flexDirection: "row",
        gap: 3,
    },
    unfilled: {
        backgroundColor: colors.surface,
    },
});
