import React from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type ViewStyle,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { haptic } from "../lib/haptics";
import { colors, typography, useAccentColors } from "../theme";

interface VexButtonProps {
    disabled?: boolean;
    glow?: boolean;
    icon?: keyof typeof Ionicons.glyphMap;
    loading?: boolean;
    onPress: () => void;
    style?: ViewStyle;
    title: string;
    variant?: "danger" | "outline" | "primary";
}

export function VexButton({
    disabled = false,
    glow = false,
    icon,
    loading = false,
    onPress,
    style,
    title,
    variant = "primary",
}: VexButtonProps) {
    const accent = useAccentColors();
    const isDanger = variant === "danger";
    const isPrimary = variant === "primary";
    const isFilled = isPrimary || isDanger;

    return (
        <View
            style={[
                styles.frame,
                glow && styles.glow,
                glow && { shadowColor: accent.accent },
                style,
            ]}
        >
            <TouchableOpacity
                activeOpacity={0.7}
                disabled={disabled || loading}
                onPress={() => {
                    haptic(isFilled ? "confirm" : "tap");
                    onPress();
                }}
                style={[
                    styles.button,
                    isDanger
                        ? styles.danger
                        : isPrimary
                          ? {
                                backgroundColor: accent.accent,
                                borderColor: accent.accent,
                            }
                          : styles.outline,
                    (disabled || loading) && styles.disabled,
                ]}
            >
                {loading ? (
                    <ActivityIndicator color={colors.text} size="small" />
                ) : (
                    <>
                        {icon ? (
                            <Ionicons
                                color={
                                    isPrimary ? accent.onAccent : colors.text
                                }
                                name={icon}
                                size={16}
                            />
                        ) : null}
                        <Text
                            style={[
                                styles.text,
                                !isFilled && styles.outlineText,
                                isPrimary && { color: accent.onAccent },
                            ]}
                        >
                            {title}
                        </Text>
                    </>
                )}
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: "center",
        borderRadius: 7,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        minHeight: 46,
        paddingHorizontal: 24,
        paddingVertical: 12,
    },
    danger: {
        backgroundColor: colors.error,
        borderColor: colors.error,
    },
    disabled: {
        opacity: 0.4,
    },
    frame: {
        alignSelf: "stretch",
        borderRadius: 7,
    },
    glow: {
        elevation: 12,
        shadowOffset: { height: 6, width: 0 },
        shadowOpacity: 0.32,
        shadowRadius: 18,
    },
    outline: {
        backgroundColor: colors.transparent,
        borderColor: colors.border,
    },
    outlineText: {
        color: colors.text,
    },
    text: {
        ...typography.button,
        color: colors.text,
    },
});
