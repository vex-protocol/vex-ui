import React from "react";
import {
    type StyleProp,
    StyleSheet,
    useWindowDimensions,
    View,
    type ViewStyle,
} from "react-native";

import { colors } from "../theme";

interface VexFieldProps {
    children: React.ReactNode;
    glows?: boolean;
    style?: StyleProp<ViewStyle>;
}

const GRID_SIZE = 28;

export function VexField({ children, glows = false, style }: VexFieldProps) {
    const { height, width } = useWindowDimensions();
    const verticalLines = React.useMemo(
        () =>
            Array.from(
                { length: Math.ceil(width / GRID_SIZE) + 1 },
                (_, index) => index,
            ),
        [width],
    );
    const horizontalLines = React.useMemo(
        () =>
            Array.from(
                { length: Math.ceil(height / GRID_SIZE) + 1 },
                (_, index) => index,
            ),
        [height],
    );

    return (
        <View style={[styles.root, style]}>
            <View pointerEvents="none" style={styles.gridLayer}>
                {verticalLines.map((index) => (
                    <View
                        key={`v-${index}`}
                        style={[styles.gridLineV, { left: index * GRID_SIZE }]}
                    />
                ))}
                {horizontalLines.map((index) => (
                    <View
                        key={`h-${index}`}
                        style={[styles.gridLineH, { top: index * GRID_SIZE }]}
                    />
                ))}
            </View>
            <View pointerEvents="none" style={styles.vignette} />
            {glows ? (
                <>
                    <View pointerEvents="none" style={styles.glowTop} />
                    <View pointerEvents="none" style={styles.glowBottom} />
                </>
            ) : null}
            <View style={styles.content}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    content: {
        flex: 1,
        zIndex: 1,
    },
    glowBottom: {
        backgroundColor: colors.accent,
        borderRadius: 90,
        bottom: -42,
        height: 150,
        left: "28%",
        opacity: 0.08,
        position: "absolute",
        width: 150,
        zIndex: 0,
    },
    glowTop: {
        backgroundColor: colors.accent,
        borderRadius: 90,
        height: 160,
        opacity: 0.08,
        position: "absolute",
        right: -46,
        top: -48,
        width: 160,
        zIndex: 0,
    },
    gridLayer: {
        ...StyleSheet.absoluteFill,
        opacity: 0.6,
        zIndex: 0,
    },
    gridLineH: {
        backgroundColor: "rgba(255,255,255,0.035)",
        height: StyleSheet.hairlineWidth,
        left: 0,
        position: "absolute",
        right: 0,
    },
    gridLineV: {
        backgroundColor: "rgba(255,255,255,0.035)",
        bottom: 0,
        position: "absolute",
        top: 0,
        width: StyleSheet.hairlineWidth,
    },
    root: {
        backgroundColor: colors.bg,
        flex: 1,
        overflow: "hidden",
        position: "relative",
    },
    vignette: {
        ...StyleSheet.absoluteFill,
        backgroundColor: "rgba(0,0,0,0.36)",
        zIndex: 0,
    },
});
