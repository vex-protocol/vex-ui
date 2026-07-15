import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { $avatarVersions, $user, avatarHue } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import { buildAvatarUrl } from "../lib/avatarUrl";
import { colors } from "../theme";

export interface AvatarProps {
    /**
     * Best-effort display name used to compute the initial in the
     * fallback tile. Falls back to the userID if not provided.
     */
    displayName?: null | string;
    /**
     * Disable the network fetch entirely (useful in places where we
     * know there's no avatar yet, e.g. in-progress signup screens).
     */
    fallbackOnly?: boolean;
    /** Optional ring color rendered around the avatar. */
    ring?: { color: string; width?: number };
    /**
     * Avatar diameter in dp. Component renders a circle of `size`x`size`.
     */
    size: number;
    /**
     * Owner of the avatar image to fetch. Required — if there is no
     * userID yet, render <View /> manually rather than passing an
     * empty string.
     */
    userID: string;
}

export function Avatar({
    displayName,
    fallbackOnly = false,
    ring,
    size,
    userID,
}: AvatarProps) {
    const versions = useStore($avatarVersions);
    const me = useStore($user);
    // Cache-bust only when *our* state knows the avatar changed for this
    // user. Other users' avatars rely on RN's image cache and HTTP
    // caching headers from the server — appending a stable URL keeps
    // them cacheable across renders.
    const version = versions[userID];
    const url = useMemo(() => {
        if (fallbackOnly) {
            return null;
        }
        return buildAvatarUrl(userID, version);
    }, [fallbackOnly, userID, version]);
    // We track which URL last failed (rather than a bare boolean) so a
    // version bump or userID change re-attempts the fetch automatically.
    // This is React's "derive state from previous props" pattern: it's
    // computed during render rather than synchronized in a useEffect,
    // which is cheaper and lints clean under `react-hooks/set-state-in-effect`.
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const [erroredUrl, setErroredUrl] = useState<null | string>(null);
    const errored = url !== null && erroredUrl === url;

    const initial = useMemo(() => {
        const source = displayName ?? me?.username ?? userID ?? "?";
        const trimmed = source.trim();
        return (trimmed.charAt(0) || "?").toUpperCase();
    }, [displayName, me?.username, userID]);

    const ringStyle = ring
        ? {
              borderColor: ring.color,
              borderWidth: ring.width ?? 2,
          }
        : null;

    const containerStyle = [
        styles.base,
        {
            borderRadius: size / 2,
            height: size,
            width: size,
        },
        ringStyle,
    ];

    if (url !== null && !errored) {
        return (
            <View style={containerStyle}>
                <Image
                    onError={() => {
                        setErroredUrl(url);
                    }}
                    source={{ uri: url }}
                    style={[
                        styles.image,
                        { borderRadius: size / 2, height: size, width: size },
                    ]}
                />
            </View>
        );
    }

    return (
        <View
            style={[
                containerStyle,
                styles.fallback,
                { backgroundColor: `hsl(${avatarHue(userID)}, 45%, 40%)` },
            ]}
        >
            <Text
                style={[
                    styles.fallbackText,
                    { fontSize: Math.max(10, Math.round(size * 0.42)) },
                ]}
            >
                {initial}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        backgroundColor: colors.surfaceLight,
        overflow: "hidden",
    },
    fallback: {
        alignItems: "center",
        justifyContent: "center",
    },
    fallbackText: {
        color: "#fff",
        fontWeight: "700",
    },
    image: {
        backgroundColor: colors.surfaceLight,
    },
});
