import type { AppScreenProps } from "../navigation/types";

import React from "react";
import {
    AccessibilityInfo,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";

import { ChatHeader } from "../components/ChatHeader";
import { VexField } from "../components/VexField";
import {
    $accentPreference,
    accentPresets,
    colors,
    setAccentPreference,
    typography,
    useAccentColors,
} from "../theme";

export function AppearanceScreen({}: AppScreenProps<"Appearance">) {
    const selectedAccent = useStore($accentPreference);
    const accent = useAccentColors();

    return (
        <VexField style={styles.container}>
            <ChatHeader title="Appearance" />
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Primary color</Text>
                    <View style={styles.swatchGrid}>
                        {accentPresets.map((preset) => {
                            const selected = preset.id === selectedAccent;
                            return (
                                <TouchableOpacity
                                    accessibilityLabel={`${preset.label} primary color`}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked: selected }}
                                    activeOpacity={0.72}
                                    key={preset.id}
                                    onPress={() => {
                                        void setAccentPreference(preset.id);
                                        AccessibilityInfo.announceForAccessibility(
                                            `${preset.label} selected`,
                                        );
                                    }}
                                    style={[
                                        styles.swatch,
                                        selected
                                            ? {
                                                  backgroundColor:
                                                      accent.accentSoft,
                                                  borderColor:
                                                      accent.accentBorder,
                                              }
                                            : null,
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.swatchColor,
                                            { backgroundColor: preset.color },
                                        ]}
                                    >
                                        {selected ? (
                                            <Ionicons
                                                color="#fff"
                                                name="checkmark"
                                                size={20}
                                            />
                                        ) : null}
                                    </View>
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.swatchLabel,
                                            selected
                                                ? { color: accent.accentText }
                                                : null,
                                        ]}
                                    >
                                        {preset.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>
        </VexField>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        paddingBottom: 32,
        paddingHorizontal: 14,
        paddingTop: 16,
    },
    section: {
        gap: 8,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.muted,
        paddingHorizontal: 4,
        textTransform: "uppercase",
    },
    swatch: {
        alignItems: "center",
        borderColor: colors.borderSubtle,
        borderRadius: 12,
        borderWidth: 1,
        flexBasis: "22%",
        flexGrow: 1,
        gap: 7,
        justifyContent: "center",
        minHeight: 78,
        minWidth: 70,
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    swatchColor: {
        alignItems: "center",
        borderColor: "rgba(255,255,255,0.28)",
        borderRadius: 18,
        borderWidth: 1,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    swatchGrid: {
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        borderRadius: 14,
        borderWidth: 1,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        padding: 8,
    },
    swatchLabel: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
});
