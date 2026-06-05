import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { colors, typography } from "../theme";

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
                    </TouchableOpacity>
                ) : (
                    <Text numberOfLines={1} style={styles.title}>
                        {title}
                    </Text>
                )}
                {subtitle && (
                    <>
                        <Text style={styles.separator}>|</Text>
                        <Text numberOfLines={1} style={styles.subtitle}>
                            {subtitle}
                        </Text>
                    </>
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
                        {overflowIcon === "users" ? (
                            <View style={styles.usersIcon}>
                                <View style={styles.usersBackHead} />
                                <View style={styles.usersFrontHead} />
                                <View style={styles.usersBody} />
                            </View>
                        ) : (
                            <Text style={styles.actionIcon}>⋮</Text>
                        )}
                    </TouchableOpacity>
                )}
                {onUsers && (
                    <TouchableOpacity
                        accessibilityLabel="Channel members"
                        hitSlop={8}
                        onPress={onUsers}
                        style={styles.actionBtn}
                    >
                        <View style={styles.usersIcon}>
                            <View style={styles.usersBackHead} />
                            <View style={styles.usersFrontHead} />
                            <View style={styles.usersBody} />
                        </View>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    actionBtn: {
        alignItems: "center",
        height: 36,
        justifyContent: "center",
        width: 36,
    },
    actionIcon: {
        color: colors.text,
        fontSize: 22,
        fontWeight: "700",
    },
    actions: {
        alignItems: "flex-end",
        flexDirection: "row",
        flexShrink: 0,
        gap: 4,
    },
    backBtn: {
        alignItems: "center",
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
    separator: {
        color: colors.muted,
        fontSize: 14,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        flex: 1,
    },
    title: {
        ...typography.button,
        color: colors.text,
        flexShrink: 1,
        fontSize: 16,
    },
    titlePressable: {
        flexShrink: 1,
    },
    usersBackHead: {
        backgroundColor: "rgba(255,255,255,0.52)",
        borderRadius: 4,
        height: 8,
        left: 4,
        position: "absolute",
        top: 5,
        width: 8,
    },
    usersBody: {
        backgroundColor: "rgba(255,255,255,0.88)",
        borderRadius: 5,
        bottom: 3,
        height: 6,
        position: "absolute",
        width: 16,
    },
    usersFrontHead: {
        backgroundColor: colors.text,
        borderRadius: 5,
        height: 10,
        position: "absolute",
        right: 5,
        top: 3,
        width: 10,
    },
    usersIcon: {
        alignItems: "center",
        height: 20,
        justifyContent: "center",
        position: "relative",
        width: 20,
    },
});
