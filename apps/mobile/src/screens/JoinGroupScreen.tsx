import type { AppScreenProps } from "../navigation/types";

import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { parseInviteID } from "@vex-chat/store";
import { vexService } from "@vex-chat/store";

import { useNavigation } from "@react-navigation/native";

import { CornerBracketBox } from "../components/CornerBracketBox";
import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { navigateToJoinedServer } from "../navigation/navigationRef";
import { colors, typography } from "../theme";

export function JoinGroupScreen({ route }: AppScreenProps<"JoinGroup">) {
    const navigation = useNavigation();
    const [input, setInput] = useState(route.params?.inviteID ?? "");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    React.useEffect(() => {
        if (!route.params?.inviteID) {
            return;
        }
        setInput(route.params.inviteID);
        setError("");
    }, [route.params?.inviteID]);

    async function handleJoin() {
        const inviteID = parseInviteID(input);
        if (!inviteID) {
            setError("Please enter a valid invite link or code");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok) {
                setError(result.error || "Failed to join server");
                setLoading(false);
                return;
            }
            if (navigateToJoinedServer(result)) {
                return;
            }
            if (navigation.canGoBack()) {
                navigation.goBack();
                return;
            }
            setLoading(false);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Failed to join server",
            );
            setLoading(false);
        }
    }

    return (
        <ScreenLayout>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.heading}>Join a group.</Text>
                    <Text style={styles.subtitle}>
                        Enter an invite link or code
                    </Text>
                </View>

                {error ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.field}>
                    <Text style={styles.label}>INVITE CODE</Text>
                    <CornerBracketBox color={colors.border} size={8}>
                        <TextInput
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!loading}
                            onChangeText={(t) => {
                                setInput(t);
                                setError("");
                            }}
                            placeholder="Paste invite link or code"
                            placeholderTextColor={colors.mutedDark}
                            style={styles.input}
                            value={input}
                        />
                    </CornerBracketBox>
                </View>

                <View style={styles.buttonRow}>
                    <VexButton
                        disabled={!input.trim()}
                        glow
                        loading={loading}
                        onPress={() => void handleJoin()}
                        title="Join"
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    buttonRow: {
        alignItems: "center",
    },
    content: {
        flex: 1,
        gap: 24,
        justifyContent: "center",
    },
    errorBox: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.error,
        borderWidth: 1,
        padding: 10,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
    },
    field: {
        gap: 6,
    },
    header: {
        alignItems: "center",
        gap: 8,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
        textAlign: "center",
    },
    input: {
        backgroundColor: colors.surface,
        color: colors.textSecondary,
        fontSize: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
});
