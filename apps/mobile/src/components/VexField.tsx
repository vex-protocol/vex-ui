import React from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { colors } from "../theme";

interface VexFieldProps {
    children: React.ReactNode;
    glows?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function VexField({ children, style }: VexFieldProps) {
    return (
        <View style={[styles.root, style]}>
            <View style={styles.content}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    content: {
        flex: 1,
    },
    root: {
        backgroundColor: colors.bg,
        flex: 1,
        overflow: "hidden",
    },
});
