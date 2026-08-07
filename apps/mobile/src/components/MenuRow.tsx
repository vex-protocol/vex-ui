import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import React from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { colors, fontFamilies, typography } from "../theme";

export type MenuRowTone = "danger" | "default" | "success";

interface MenuRowProps {
    /**
     * Custom node rendered in the right slot. When provided, the chevron
     * is suppressed (use `showChevron` to force it back on).
     */
    accessory?: ReactNode | undefined;
    description?: string | undefined;
    disabled?: boolean | undefined;
    icon: keyof typeof Ionicons.glyphMap;
    /**
     * Override the default badge background. Useful for stacked icon badges
     * matching iOS-style settings rows (e.g. blue for "About").
     */
    iconBg?: string | undefined;
    iconColor?: string | undefined;
    label: string;
    /**
     * Render a single-line, horizontally scrollable monospaced strip below
     * the label. Use for long identifiers (user IDs, device IDs, key
     * fingerprints): the strip never wraps so the row stays one row tall,
     * the text is `selectable` so users can long-press → copy, and they
     * can swipe sideways inside the strip to reveal characters that don't
     * fit on screen.
     */
    monoBlock?: string | undefined;
    monoValue?: boolean | undefined;
    onPress?: (() => void) | undefined;
    /**
     * Render a chevron on the right edge. Defaults to `true` whenever the row
     * has an `onPress` handler and no `accessory` is supplied.
     */
    showChevron?: boolean | undefined;
    style?: StyleProp<ViewStyle> | undefined;
    tone?: MenuRowTone | undefined;
    /**
     * Inline value text displayed before any chevron. Used for simple
     * informational rows (e.g. "Version 0.1.0").
     */
    value?: string | undefined;
}

interface MenuSectionProps {
    children: ReactNode;
    footer?: string;
    title?: string;
}

export function MenuRow({
    accessory,
    description,
    disabled,
    icon,
    iconBg,
    iconColor,
    label,
    monoBlock,
    monoValue,
    onPress,
    showChevron,
    style,
    tone = "default",
    value,
}: MenuRowProps) {
    const palette =
        tone === "danger"
            ? {
                  icon: colors.dangerText,
                  iconBg: colors.dangerBg,
                  iconBorder: colors.dangerBorder,
                  label: colors.dangerText,
              }
            : tone === "success"
              ? {
                    icon: colors.successText,
                    iconBg: colors.successBg,
                    iconBorder: colors.successBorder,
                    label: colors.textSecondary,
                }
              : {
                    icon: colors.textSecondary,
                    iconBg: colors.surfaceLight,
                    iconBorder: colors.borderSubtle,
                    label: colors.textSecondary,
                };
    const renderChevron =
        showChevron ?? (onPress != null && accessory == null && value == null);

    const head = (
        <View style={styles.head}>
            <View
                style={[
                    styles.iconBadge,
                    {
                        backgroundColor: iconBg ?? palette.iconBg,
                        borderColor: palette.iconBorder,
                    },
                ]}
            >
                <Ionicons
                    color={iconColor ?? palette.icon}
                    name={icon}
                    size={18}
                />
            </View>
            <View style={styles.info}>
                <Text
                    numberOfLines={1}
                    style={[styles.label, { color: palette.label }]}
                >
                    {label}
                </Text>
                {description != null ? (
                    <Text
                        ellipsizeMode="tail"
                        numberOfLines={1}
                        style={styles.description}
                    >
                        {description}
                    </Text>
                ) : null}
            </View>
            {value != null ? (
                <Text
                    numberOfLines={1}
                    style={[styles.value, monoValue ? styles.mono : null]}
                >
                    {value}
                </Text>
            ) : null}
            {accessory}
            {renderChevron ? (
                <Ionicons
                    color={colors.mutedDark}
                    name="chevron-forward"
                    size={18}
                />
            ) : null}
        </View>
    );

    const inner =
        monoBlock != null ? (
            <>
                {head}
                <ScrollView
                    contentContainerStyle={styles.monoBlockContent}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.monoBlockBox}
                >
                    <Text selectable style={styles.monoBlockText}>
                        {monoBlock}
                    </Text>
                </ScrollView>
            </>
        ) : (
            head
        );

    const containerStyle = [
        monoBlock != null ? styles.rowVertical : styles.row,
        disabled === true ? styles.rowDisabled : null,
        style,
    ];

    if (onPress != null) {
        return (
            <TouchableOpacity
                activeOpacity={0.7}
                disabled={disabled}
                onPress={onPress}
                style={containerStyle}
            >
                {inner}
            </TouchableOpacity>
        );
    }

    return <View style={containerStyle}>{inner}</View>;
}

export function MenuSection({ children, footer, title }: MenuSectionProps) {
    return (
        <View style={styles.section}>
            {title != null ? (
                <Text style={styles.sectionTitle}>{title}</Text>
            ) : null}
            <View style={styles.sectionRows}>{children}</View>
            {footer != null ? (
                <Text style={styles.sectionFooter}>{footer}</Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    description: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 12,
        lineHeight: 16,
    },
    head: {
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 36,
        width: "100%",
    },
    iconBadge: {
        alignItems: "center",
        borderRadius: 9,
        borderWidth: 1,
        height: 34,
        justifyContent: "center",
        width: 34,
    },
    info: {
        flex: 1,
        gap: 2,
        minWidth: 0,
    },
    label: {
        ...typography.button,
        fontSize: 14,
        fontWeight: "600",
    },
    mono: {
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        letterSpacing: 0,
    },
    monoBlockBox: {
        alignSelf: "stretch",
        backgroundColor: colors.rail,
        borderColor: colors.borderSubtle,
        borderRadius: 6,
        borderWidth: 1,
        marginLeft: 46,
    },
    monoBlockContent: {
        alignItems: "center",
        flexDirection: "row",
        minWidth: "100%",
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    monoBlockText: {
        color: colors.textSecondary,
        flexShrink: 0,
        fontFamily: fontFamilies.mono,
        fontSize: 12,
        letterSpacing: 0,
        lineHeight: 18,
    },
    row: {
        alignItems: "center",
        backgroundColor: colors.transparent,
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    rowDisabled: {
        opacity: 0.5,
    },
    rowVertical: {
        backgroundColor: colors.transparent,
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "column",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    section: {
        gap: 8,
    },
    sectionFooter: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 12,
        paddingHorizontal: 4,
    },
    sectionRows: {
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        borderRadius: 12,
        borderWidth: 1,
        overflow: "hidden",
    },
    sectionTitle: {
        ...typography.label,
        color: colors.muted,
        paddingHorizontal: 4,
        textTransform: "uppercase",
    },
    value: {
        ...typography.body,
        color: colors.muted,
        fontSize: 13,
        maxWidth: 180,
        textAlign: "right",
    },
});
