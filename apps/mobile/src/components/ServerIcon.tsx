import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { avatarHue } from "@vex-chat/store";

import { buildServerIconUrl } from "../lib/serverIconUrl";

interface ServerIconProps {
    iconID?: null | string;
    name: string;
    serverID: string;
    size: number;
}

export function ServerIcon({ iconID, name, serverID, size }: ServerIconProps) {
    const url = useMemo(
        () => (iconID ? buildServerIconUrl(iconID) : null),
        [iconID],
    );
    const [erroredUrl, setErroredUrl] = useState<null | string>(null);
    const borderRadius = Math.min(8, Math.round(size * 0.2));

    if (url && erroredUrl !== url) {
        return (
            <Image
                accessibilityLabel={`${name} group icon`}
                onError={() => {
                    setErroredUrl(url);
                }}
                source={{ uri: url }}
                style={{ borderRadius, height: size, width: size }}
            />
        );
    }

    const initial = (name.trim().charAt(0) || "#").toUpperCase();
    return (
        <View
            accessibilityLabel={`${name} group icon`}
            style={[
                styles.fallback,
                {
                    backgroundColor: `hsl(${avatarHue(serverID)}, 42%, 34%)`,
                    borderRadius,
                    height: size,
                    width: size,
                },
            ]}
        >
            <Text
                style={[
                    styles.initial,
                    { fontSize: Math.max(11, Math.round(size * 0.36)) },
                ]}
            >
                {initial}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    fallback: {
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    initial: {
        color: "#fff",
        fontWeight: "700",
    },
});
