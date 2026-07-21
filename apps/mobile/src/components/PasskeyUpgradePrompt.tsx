import React, { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
    $hydrationStatus,
    $passkeyUpgradePrompt,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isPasskeySupported } from "../lib/passkey";
import { navigateToPasskeys } from "../navigation/navigationRef";
import { colors, fontFamilies, typography } from "../theme";

import { VexButton } from "./VexButton";

export function PasskeyUpgradePrompt() {
    const hydrationStatus = useStore($hydrationStatus);
    const prompt = useStore($passkeyUpgradePrompt);
    const safeArea = useSafeAreaInsets();
    const supported = isPasskeySupported();

    useEffect(() => {
        if (prompt && !supported) {
            vexService.dismissPasskeyUpgradePrompt();
        }
    }, [prompt, supported]);

    if (!prompt || !hydrationStatus.ready || !supported) {
        return null;
    }

    const fromAnotherAuthenticator = prompt.reason === "cross_platform_passkey";
    const suggestedName = passkeyNameForDevice(prompt.deviceName);
    const deviceLabel = deviceLabelForPrompt(prompt.deviceName);
    const dismiss = (): void => {
        vexService.dismissPasskeyUpgradePrompt();
    };
    const continueSetup = (): void => {
        const navigated = navigateToPasskeys({
            reason: prompt.reason,
            startSetup: true,
            suggestedName,
        });
        if (navigated) {
            dismiss();
        }
    };

    return (
        <Modal
            animationType="fade"
            onRequestClose={dismiss}
            presentationStyle="overFullScreen"
            statusBarTranslucent
            transparent
            visible
        >
            <Pressable
                onPress={dismiss}
                style={[
                    styles.backdrop,
                    { paddingBottom: Math.max(safeArea.bottom, 12) },
                ]}
            >
                <Pressable
                    accessibilityViewIsModal
                    onPress={(event) => {
                        event.stopPropagation();
                    }}
                    style={styles.sheet}
                >
                    <View style={styles.iconWrap}>
                        <Ionicons
                            color={colors.textSecondary}
                            name="key-outline"
                            size={24}
                        />
                    </View>
                    <View style={styles.copy}>
                        <Text style={styles.eyebrow}>FASTER SIGN-IN</Text>
                        <Text style={styles.title}>
                            {fromAnotherAuthenticator
                                ? "Add a passkey to this device"
                                : "Skip your password next time"}
                        </Text>
                        <Text style={styles.body}>
                            {fromAnotherAuthenticator
                                ? `You signed in with a passkey from another device or security key. Add one to ${deviceLabel} for faster access next time.`
                                : `Create a passkey for ${deviceLabel}. Sign in with your face, fingerprint, or device PIN while keeping your password as a backup.`}
                        </Text>
                    </View>
                    <View style={styles.actions}>
                        <VexButton
                            icon="key-outline"
                            onPress={continueSetup}
                            title="Create passkey"
                        />
                        <VexButton
                            onPress={dismiss}
                            title="Not now"
                            variant="outline"
                        />
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function deviceLabelForPrompt(deviceName: string): string {
    const normalized = deviceName.trim().toLowerCase();
    if (normalized === "ios") return "this iPhone";
    if (normalized === "android") return "this Android device";
    return deviceName.trim() || "this device";
}

function passkeyNameForDevice(deviceName: string): string {
    const normalized = deviceName.trim().toLowerCase();
    if (normalized === "ios") return "iPhone";
    if (normalized === "android") return "Android phone";
    return deviceName.trim() || "This device";
}

const styles = StyleSheet.create({
    actions: {
        gap: 10,
    },
    backdrop: {
        backgroundColor: colors.overlay,
        flex: 1,
        justifyContent: "flex-end",
        padding: 12,
    },
    body: {
        ...typography.body,
        color: colors.muted,
    },
    copy: {
        gap: 8,
    },
    eyebrow: {
        ...typography.label,
        color: colors.mutedDark,
    },
    iconWrap: {
        alignItems: "center",
        backgroundColor: colors.elevated,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        height: 46,
        justifyContent: "center",
        width: 46,
    },
    sheet: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 20,
        padding: 20,
    },
    title: {
        color: colors.text,
        fontFamily: fontFamilies.heading,
        fontSize: 24,
        fontWeight: "700",
        letterSpacing: 0,
        lineHeight: 29,
    },
});
