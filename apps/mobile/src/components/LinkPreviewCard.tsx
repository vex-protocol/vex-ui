import type { LinkPreviewMetadata } from "@vex-chat/store";

import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { openExternalUrl } from "../lib/externalLinks";
import { loadLinkPreviewForContent } from "../lib/linkPreview";
import { colors, typography } from "../theme";

export function LinkPreviewCard({ content }: { content: string }) {
    const [imageFailed, setImageFailed] = React.useState(false);
    const [preview, setPreview] = React.useState<LinkPreviewMetadata | null>(
        null,
    );

    React.useEffect(() => {
        let cancelled = false;
        setPreview(null);
        setImageFailed(false);

        void loadLinkPreviewForContent(content).then((nextPreview) => {
            if (!cancelled) {
                setPreview(nextPreview);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [content]);

    if (!preview) {
        return null;
    }

    const displayUrl = displayUrlForPreview(preview.url);
    const hasImage = preview.imageUrl && !imageFailed;

    return (
        <Pressable
            accessibilityRole="link"
            onPress={() => {
                openExternalUrl(preview.url);
            }}
            style={({ pressed }) => [
                styles.card,
                pressed ? styles.cardPressed : null,
            ]}
        >
            {hasImage ? (
                <Image
                    onError={() => {
                        setImageFailed(true);
                    }}
                    resizeMode="cover"
                    source={{ uri: preview.imageUrl }}
                    style={styles.image}
                />
            ) : null}
            <View style={styles.copy}>
                <View style={styles.sourceRow}>
                    {preview.faviconUrl ? (
                        <Image
                            source={{ uri: preview.faviconUrl }}
                            style={styles.favicon}
                        />
                    ) : (
                        <Ionicons
                            color={colors.muted}
                            name="link-outline"
                            size={13}
                        />
                    )}
                    <Text numberOfLines={1} style={styles.source}>
                        {preview.siteName || displayUrl}
                    </Text>
                </View>
                <Text numberOfLines={2} style={styles.title}>
                    {preview.title}
                </Text>
                {preview.description ? (
                    <Text numberOfLines={2} style={styles.description}>
                        {preview.description}
                    </Text>
                ) : null}
                <Text numberOfLines={1} style={styles.url}>
                    {displayUrl}
                </Text>
            </View>
        </Pressable>
    );
}

function displayUrlForPreview(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.hostname.replace(/^www\./i, "")}${parsed.pathname}`;
    } catch {
        return url;
    }
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: "rgba(255,255,255,0.045)",
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 6,
        maxWidth: 360,
        overflow: "hidden",
    },
    cardPressed: {
        opacity: 0.84,
    },
    copy: {
        gap: 4,
        padding: 10,
    },
    description: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17,
    },
    favicon: {
        borderRadius: 2,
        height: 13,
        width: 13,
    },
    image: {
        backgroundColor: colors.input,
        height: 150,
        width: "100%",
    },
    source: {
        ...typography.body,
        color: colors.muted,
        flex: 1,
        fontSize: 11,
        fontWeight: "600",
    },
    sourceRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
    },
    title: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 14,
    },
    url: {
        ...typography.body,
        color: colors.info,
        fontSize: 11,
    },
});
