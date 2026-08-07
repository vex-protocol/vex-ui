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
                glow && {
                    elevation: 12,
                    shadowColor: isDanger ? colors.error : accent.accent,
                    shadowOffset: { height: 8, width: 0 },
                    shadowOpacity: 0.42,
                    shadowRadius: 18,
                },
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
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        minHeight: 48,
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
        borderRadius: 10,
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
