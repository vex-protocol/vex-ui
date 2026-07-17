import React from "react";
import { StyleSheet, Text, View } from "react-native";

import Svg, { Path } from "react-native-svg";

import { colors, fontFamilies, useAccentColors } from "../theme";

interface VexLogoProps {
    showWordmark?: boolean;
    size?: number;
}

export function VexLogo({ showWordmark = true, size = 36 }: VexLogoProps) {
    const accent = useAccentColors();

    return (
        <View style={styles.row}>
            <Svg
                fill="none"
                height={size}
                viewBox="0 0 57.341 53.9646"
                width={size}
            >
                <Path
                    clipRule="evenodd"
                    d="M32.0534 0.195458C38.5429 0.193928 44.7851 2.69208 49.491 7.1739C54.197 11.6558 57.0072 17.7792 57.341 24.2795C57.3682 24.7299 57.3435 25.3557 57.3435 25.5857V26.8514L57.3402 26.9069C56.8987 34.3394 53.6014 41.3108 48.1413 46.3554C42.6812 51.4 35.4837 54.1249 28.062 53.9573C20.6403 53.7897 13.5724 50.7427 8.34426 45.4567C3.11609 40.1708 0.134908 33.0576 0.0274235 25.6127L0 23.7164H6.80126C7.20645 17.9596 9.55991 12.4917 13.5022 8.23673C17.8706 3.52181 23.8629 0.648811 30.2646 0.199961L30.3295 0.195458H32.0534ZM44.6241 11.7979C41.1148 8.45405 36.4248 6.64536 31.5859 6.76972C26.747 6.8941 22.1555 8.94122 18.8216 12.4609C17.1708 14.2037 15.8784 16.2556 15.0182 18.4993C14.1581 20.743 13.7469 23.1347 13.8083 25.5378L13.8089 25.5617V30.7576H7.74919C8.82181 35.0697 11.1959 38.9661 14.5723 41.898C18.4986 45.3075 23.5177 47.185 28.7112 47.1869H30.3221C35.5818 46.7967 40.5174 44.4868 44.1941 40.6926C46.8886 37.912 48.7691 34.4764 49.6759 30.7594L41.2432 25.893L31.2254 31.6743V15.8366L41.2432 21.6182L48.6098 17.3665C47.6517 15.2948 46.3068 13.4013 44.6241 11.7979Z"
                    fill={accent.accent}
                    fillRule="evenodd"
                />
            </Svg>
            {showWordmark && (
                <Text
                    style={[
                        styles.text,
                        { fontSize: size * 0.85, lineHeight: size },
                    ]}
                >
                    vex
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        alignItems: "center",
        flexDirection: "row",
        gap: 4,
    },
    text: {
        color: colors.text,
        fontFamily: fontFamilies.heading,
        fontWeight: "500",
    },
});
