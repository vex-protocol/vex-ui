import type { AppScreenProps } from "../navigation/types";
import type { Invite } from "@vex-chat/libvex";

import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Clipboard,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { formatInviteLink, vexService } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";

import { ChatHeader } from "../components/ChatHeader";
import { CornerBracketBox } from "../components/CornerBracketBox";
import { VexButton } from "../components/VexButton";
import { VexField } from "../components/VexField";
import { colors, fontFamilies, typography, useAccentColors } from "../theme";

const DURATIONS: { label: string; value: string }[] = [
    { label: "1 hour", value: "1h" },
    { label: "1 day", value: "1d" },
    { label: "7 days", value: "7d" },
    { label: "30 days", value: "30d" },
];

export function InviteScreen({ route }: AppScreenProps<"Invite">) {
    const accent = useAccentColors();
    const { serverID, serverName } = route.params;
    const [duration, setDuration] = useState("7d");
    const [invites, setInvites] = useState<Invite[]>([]);
    const [loadingInvites, setLoadingInvites] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState("");
    const inviteLoadTokenRef = useRef(0);

    async function loadInvites({
        clearBeforeLoad = false,
    }: { clearBeforeLoad?: boolean } = {}): Promise<void> {
        const loadToken = inviteLoadTokenRef.current + 1;
        inviteLoadTokenRef.current = loadToken;
        setLoadingInvites(true);
        setError("");
        if (clearBeforeLoad) {
            setInvites([]);
        }
        try {
            const loaded = await vexService.getInvites(serverID);
            if (inviteLoadTokenRef.current === loadToken) {
                setInvites(loaded);
            }
        } catch (err: unknown) {
            if (inviteLoadTokenRef.current === loadToken) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load invites",
                );
            }
        } finally {
            if (inviteLoadTokenRef.current === loadToken) {
                setLoadingInvites(false);
            }
        }
    }

    useEffect(() => {
        void loadInvites({ clearBeforeLoad: true });
        // serverID changes only when navigating to a different server invite screen
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverID]);

    async function handleCreateInvite(): Promise<void> {
        setCreating(true);
        setError("");
        try {
            const result = await vexService.createInvite(serverID, duration);
            setInvites((prev) => [result, ...prev]);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to create");
        } finally {
            setCreating(false);
        }
    }

    function copy(text: string, label: string): void {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- RN Clipboard is the supported API on bare app
        Clipboard.setString(text);
        Alert.alert("Copied", `${label} copied to clipboard.`);
    }

    async function handleShare(link: string): Promise<void> {
        try {
            await Share.share({
                message: `Join ${serverName ?? "my server"} on Vex: ${link}`,
            });
        } catch {
            /* user cancelled */
        }
    }

    const primaryInvite = loadingInvites ? undefined : invites[0];
    const primaryLink = primaryInvite
        ? formatInviteLink(primaryInvite.inviteID)
        : null;

    return (
        <VexField glows style={styles.container}>
            <ChatHeader title="Invite" />
            <ScrollView
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <Text style={[styles.kicker, { color: accent.accentText }]}>
                        {serverName ?? "GROUP INVITE"}
                    </Text>
                    <Text style={styles.heading}>Invite to group</Text>
                </View>

                {primaryInvite ? (
                    <>
                        <View style={styles.qrWrap}>
                            <CornerBracketBox color={accent.accent} size={10}>
                                <View style={styles.qrSurface}>
                                    <Ionicons
                                        color={colors.text}
                                        name="qr-code-outline"
                                        size={118}
                                    />
                                </View>
                            </CornerBracketBox>
                        </View>

                        <View style={styles.codeBlock}>
                            <Text style={styles.label}>INVITE CODE</Text>
                            <View style={styles.codeRow}>
                                <Text numberOfLines={1} style={styles.codeText}>
                                    {primaryInvite.inviteID}
                                </Text>
                                <TouchableOpacity
                                    accessibilityLabel="Copy invite code"
                                    onPress={() => {
                                        copy(
                                            primaryInvite.inviteID,
                                            "Invite code",
                                        );
                                    }}
                                    style={styles.iconBtn}
                                >
                                    <Ionicons
                                        color={colors.muted}
                                        name="copy-outline"
                                        size={18}
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.infoCard}>
                            <Ionicons
                                color={colors.infoText}
                                name="information-circle-outline"
                                size={18}
                            />
                            <Text style={styles.infoText}>
                                Codes expire based on the duration selected
                                below.
                            </Text>
                        </View>

                        {primaryLink ? (
                            <VexButton
                                glow
                                icon="share-outline"
                                onPress={() => void handleShare(primaryLink)}
                                title="Share invite"
                            />
                        ) : null}
                    </>
                ) : (
                    <View style={styles.infoCard}>
                        <Ionicons
                            color={colors.infoText}
                            name="information-circle-outline"
                            size={18}
                        />
                        <Text style={styles.infoText}>
                            Create an invite link to show a shareable code here.
                        </Text>
                    </View>
                )}

                <Text style={styles.label}>CREATE INVITE</Text>
                <View style={styles.durationRow}>
                    {DURATIONS.map((d) => {
                        const selected = duration === d.value;
                        return (
                            <TouchableOpacity
                                key={d.value}
                                onPress={() => {
                                    setDuration(d.value);
                                }}
                                style={[
                                    styles.durationChip,
                                    selected && styles.durationChipActive,
                                    selected && {
                                        backgroundColor: accent.accent,
                                        borderColor: accent.accent,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.durationLabel,
                                        selected && styles.durationLabelActive,
                                    ]}
                                >
                                    {d.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                <View style={styles.actions}>
                    <VexButton
                        disabled={creating}
                        icon="link-outline"
                        loading={creating}
                        onPress={() => void handleCreateInvite()}
                        style={styles.createButton}
                        title="Create invite link"
                    />
                    <TouchableOpacity
                        disabled={loadingInvites}
                        onPress={() => {
                            void loadInvites();
                        }}
                        style={styles.btn}
                    >
                        <Text style={styles.btnText}>
                            {loadingInvites ? "Refreshing..." : "Refresh list"}
                        </Text>
                    </TouchableOpacity>
                </View>

                <Text style={[styles.label, styles.listLabel]}>
                    ACTIVE INVITES
                </Text>
                {loadingInvites ? (
                    <ActivityIndicator color={colors.textSecondary} />
                ) : invites.length === 0 ? (
                    <Text style={styles.resetText}>
                        No active invite links yet.
                    </Text>
                ) : (
                    <View style={styles.inviteList}>
                        {invites.map((item) => {
                            const link = formatInviteLink(item.inviteID);
                            return (
                                <View
                                    key={item.inviteID}
                                    style={styles.inviteCard}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={styles.fieldValue}
                                    >
                                        {link}
                                    </Text>
                                    <Text style={styles.expires}>
                                        Expires{" "}
                                        {new Date(
                                            item.expiration,
                                        ).toLocaleString()}
                                    </Text>
                                    <View style={styles.actions}>
                                        <TouchableOpacity
                                            onPress={() =>
                                                copy(link, "Invite link")
                                            }
                                            style={styles.btn}
                                        >
                                            <Text style={styles.btnText}>
                                                Copy link
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() =>
                                                copy(
                                                    item.inviteID,
                                                    "Invite code",
                                                )
                                            }
                                            style={styles.btn}
                                        >
                                            <Text style={styles.btnText}>
                                                Copy code
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() =>
                                                void handleShare(link)
                                            }
                                            style={[
                                                styles.btn,
                                                styles.btnPrimary,
                                                {
                                                    backgroundColor:
                                                        accent.accent,
                                                    borderColor: accent.accent,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.btnText,
                                                    styles.btnPrimaryText,
                                                ]}
                                            >
                                                Share
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}
                {error !== "" && (
                    <Text style={[styles.error, { color: colors.dangerText }]}>
                        {error}
                    </Text>
                )}
            </ScrollView>
        </VexField>
    );
}

const styles = StyleSheet.create({
    actions: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 16,
    },
    body: {
        paddingBottom: 24,
        paddingHorizontal: 16,
        paddingTop: 18,
    },
    btn: {
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    btnPrimary: {},
    btnPrimaryText: { color: "#FFFFFF" },
    btnText: { ...typography.button, color: colors.text },
    codeBlock: {
        gap: 8,
        marginBottom: 16,
    },
    codeRow: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        minHeight: 50,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    codeText: {
        color: colors.text,
        flex: 1,
        fontFamily: fontFamilies.mono,
        fontSize: 15,
        letterSpacing: 1,
    },
    container: { backgroundColor: colors.bg, flex: 1 },
    createButton: {
        width: "100%",
    },
    durationChip: {
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    durationChipActive: {},
    durationLabel: { ...typography.body, color: colors.text },
    durationLabelActive: { color: "#FFFFFF", fontWeight: "600" },
    durationRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 16,
        marginTop: 8,
    },
    error: { marginBottom: 12 },
    expires: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        marginTop: 8,
    },
    fieldValue: { ...typography.body, color: colors.text },
    heading: {
        ...typography.headingSmall,
        color: colors.text,
    },
    hero: {
        gap: 6,
        marginBottom: 18,
    },
    iconBtn: {
        alignItems: "center",
        height: 32,
        justifyContent: "center",
        width: 32,
    },
    infoCard: {
        alignItems: "center",
        backgroundColor: colors.infoBg,
        borderColor: colors.infoBorder,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        marginBottom: 18,
        padding: 14,
    },
    infoText: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
        fontSize: 13,
    },
    inviteCard: {
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: colors.borderSubtle,
        borderWidth: 1,
        padding: 10,
    },
    inviteList: {
        gap: 10,
    },
    kicker: {
        ...typography.label,
    },
    label: { ...typography.label, color: colors.muted, fontSize: 12 },
    listLabel: { marginTop: 12 },
    qrSurface: {
        alignItems: "center",
        backgroundColor: colors.surface,
        height: 186,
        justifyContent: "center",
        width: 186,
    },
    qrWrap: {
        alignItems: "center",
        marginBottom: 18,
    },
    resetText: { color: colors.muted },
});
