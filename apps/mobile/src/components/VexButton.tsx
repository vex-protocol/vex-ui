import React from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    type ViewStyle,
} from "react-native";

import { haptic } from "../lib/haptics";
import { colors, typography } from "../theme";

import { CornerBracketBox } from "./CornerBracketBox";

interface VexButtonProps {
    disabled?: boolean;
    glow?: boolean;
    loading?: boolean;
    onPress: () => void;
    style?: ViewStyle;
    title: string;
    variant?: "danger" | "outline" | "primary";
}

export function VexButton({
    disabled = false,
    glow = false,
    loading = false,
    onPress,
    style,
    title,
    variant = "primary",
}: VexButtonProps) {
    const isDanger = variant === "danger";
    const isPrimary = variant === "primary";
    const isFilled = isPrimary || isDanger;

    return (
        <CornerBracketBox
            color={
                isDanger
                    ? colors.error
                    : isPrimary
                      ? colors.accent
                      : colors.border
            }
            size={8}
            style={StyleSheet.flatten([glow && styles.glow, style])}
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
                          ? styles.primary
                          : styles.outline,
                    (disabled || loading) && styles.disabled,
                ]}
            >
                {loading ? (
                    <ActivityIndicator color={colors.text} size="small" />
                ) : (
                    <Text
                        style={[styles.text, !isFilled && styles.outlineText]}
                    >
                        {title}
                    </Text>
                )}
            </TouchableOpacity>
        </CornerBracketBox>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 48,
        paddingVertical: 14,
    },
    danger: {
        backgroundColor: colors.error,
    },
    disabled: {
        opacity: 0.4,
    },
    glow: {
        elevation: 12,
        shadowColor: colors.accent,
        shadowOffset: { height: 6, width: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 20,
    },
    outline: {
        backgroundColor: colors.transparent,
        borderColor: colors.border,
        borderWidth: 1,
    },
    outlineText: {
        color: colors.text,
    },
    primary: {
        backgroundColor: colors.accent,
    },
    text: {
        ...typography.button,
        color: colors.text,
    },
});
