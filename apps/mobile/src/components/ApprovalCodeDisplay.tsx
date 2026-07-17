import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, typography, useAccentColors } from "../theme";

import { CornerBracketBox } from "./CornerBracketBox";

const CODE_LENGTH = 6;

export function ApprovalCodeDisplay({
    code,
    compact = false,
    helperText,
    label,
}: {
    code: string;
    compact?: boolean;
    helperText?: string;
    label?: string;
}) {
    const accent = useAccentColors();
    const normalized = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return (
        <View style={[styles.container, compact && styles.containerCompact]}>
            {label ? <Text style={styles.label}>{label}</Text> : null}
            <View style={[styles.codeRow, compact && styles.codeRowCompact]}>
                {Array.from({ length: CODE_LENGTH }).map((_, i) => {
                    const filled = i < normalized.length;
                    return (
                        <CornerBracketBox
                            color={filled ? accent.accent : colors.border}
                            key={i}
                            size={compact ? 3 : 6}
                        >
                            <View
                                style={[
                                    styles.cell,
                                    compact && styles.cellCompact,
                                    filled && {
                                        borderColor: accent.accent,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.cellText,
                                        compact && styles.cellTextCompact,
                                    ]}
                                >
                                    {normalized[i] ?? ""}
                                </Text>
                            </View>
                        </CornerBracketBox>
                    );
                })}
            </View>
            {helperText ? (
                <Text style={styles.helper}>{helperText}</Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    cell: {
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        height: 56,
        justifyContent: "center",
        width: 48,
    },
    cellCompact: {
        height: 30,
        width: 24,
    },
    cellText: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 24,
    },
    cellTextCompact: {
        fontSize: 12,
        lineHeight: 14,
    },
    codeRow: {
        flexDirection: "row",
        gap: 10,
    },
    codeRowCompact: {
        gap: 4,
    },
    container: {
        gap: 8,
    },
    containerCompact: {
        gap: 6,
    },
    helper: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
});
