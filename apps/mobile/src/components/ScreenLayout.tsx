import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VexField } from "./VexField";

interface ScreenLayoutProps {
    children: React.ReactNode;
    glows?: boolean;
    padded?: boolean;
    style?: ViewStyle;
}

export function ScreenLayout({
    children,
    glows = false,
    padded = true,
    style,
}: ScreenLayoutProps) {
    const insets = useSafeAreaInsets();

    return (
        <VexField glows={glows}>
            <View
                style={[
                    styles.content,
                    padded && { paddingHorizontal: 24 },
                    {
                        paddingBottom: insets.bottom + 16,
                        paddingTop: insets.top + 16,
                    },
                    style,
                ]}
            >
                {children}
            </View>
        </VexField>
    );
}

const styles = StyleSheet.create({
    content: {
        flex: 1,
    },
});
