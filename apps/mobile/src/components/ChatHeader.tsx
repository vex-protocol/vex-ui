import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { colors, fontFamilies, typography } from "../theme";

const TOPBAR_LEFT_GUTTER = 52;
const TOPBAR_HEIGHT = 56;

interface ChatHeaderProps {
    onBack?: () => void;
    onOverflow?: () => void;
    onTitlePress?: () => void;
    onUsers?: () => void;
    onVoiceCall?: () => void;
    overflowIcon?: "dots" | "users";
    subtitle?: string;
    title: string;
}

export function ChatHeader({
    onBack,
    onOverflow,
    onTitlePress,
    onUsers,
    onVoiceCall,
    overflowIcon = "dots",
    subtitle,
    title,
}: ChatHeaderProps) {
    return (
        <View style={styles.container}>
            <View style={styles.breadcrumb}>
                {onBack && (
                    <TouchableOpacity
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={onBack}
                        style={styles.backBtn}
                    >
                        <Ionicons
                            color={colors.text}
                            name="chevron-back"
                            size={24}
                        />
                    </TouchableOpacity>
                )}
                {onTitlePress ? (
                    <TouchableOpacity
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={onTitlePress}
                        style={styles.titlePressable}
                    >
                        <Text numberOfLines={1} style={styles.title}>
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text numberOfLines={1} style={styles.subtitle}>
                                {subtitle}
                            </Text>
                        ) : null}
                    </TouchableOpacity>
                ) : (
                    <View style={styles.titleBlock}>
                        <Text numberOfLines={1} style={styles.title}>
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text numberOfLines={1} style={styles.subtitle}>
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                )}
            </View>
            <View style={styles.actions}>
                {onVoiceCall && (
                    <TouchableOpacity
                        accessibilityLabel="Start voice call"
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={onVoiceCall}
                        style={styles.actionBtn}
                    >
                        <Ionicons
                            color={colors.text}
                            name="call-outline"
                            size={20}
                        />
                    </TouchableOpacity>
                )}
                {onOverflow && (
                    <TouchableOpacity
                        accessibilityLabel="Channel menu"
                        hitSlop={8}
                        onPress={onOverflow}
                        style={styles.actionBtn}
                    >
                        <Ionicons
                            color={colors.muted}
                            name={
                                overflowIcon === "users"
                                    ? "people-outline"
                                    : "ellipsis-vertical"
                            }
                            size={20}
                        />
                    </TouchableOpacity>
                )}
                {onUsers && (
                    <TouchableOpacity
                        accessibilityLabel="Channel members"
                        hitSlop={8}
                        onPress={onUsers}
                        style={styles.actionBtn}
                    >
                        <Ionicons
                            color={colors.muted}
                            name="people-outline"
                            size={20}
                        />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    actionBtn: {
        alignItems: "center",
        borderRadius: 7,
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    actions: {
        alignItems: "flex-end",
        flexDirection: "row",
        flexShrink: 0,
        gap: 4,
    },
    backBtn: {
        alignItems: "center",
        borderRadius: 7,
        height: 36,
        justifyContent: "center",
        marginRight: 2,
        width: 36,
    },
    breadcrumb: {
        alignItems: "center",
        flex: 1,
        flexDirection: "row",
        gap: 8,
        minWidth: 0,
    },
    container: {
        alignItems: "center",
        backgroundColor: colors.bg,
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        flexDirection: "row",
        height: TOPBAR_HEIGHT,
        justifyContent: "space-between",
        paddingLeft: TOPBAR_LEFT_GUTTER,
        paddingRight: 12,
    },
    subtitle: {
        ...typography.body,
        color: colors.mutedDark,
        fontFamily: fontFamilies.mono,
        fontSize: 10,
        letterSpacing: 0.4,
        lineHeight: 13,
    },
    title: {
        ...typography.button,
        color: colors.text,
        flexShrink: 1,
        fontFamily: fontFamilies.heading,
        fontSize: 15,
        letterSpacing: -0.2,
        lineHeight: 19,
    },
    titleBlock: {
        flex: 1,
        minWidth: 0,
    },
    titlePressable: {
        flex: 1,
        flexShrink: 1,
        minWidth: 0,
    },
});
