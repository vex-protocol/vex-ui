import type { AuthScreenProps } from "../navigation/types";

import React, { useEffect, useMemo, useState } from "react";
import {
    Animated,
    Easing,
    StyleSheet,
    Text,
    Vibration,
    View,
} from "react-native";

import { vexService } from "@vex-chat/store";

import { ScreenLayout } from "../components/ScreenLayout";
import { VexButton } from "../components/VexButton";
import { VexLogo } from "../components/VexLogo";
import { getServerOptions } from "../lib/config";
import { keychainKeyStore } from "../lib/keychain";
import { mobileConfig } from "../lib/platform";
import { colors, typography } from "../theme";

type Props = AuthScreenProps<"ProvisionDevice">;

type ProvisionPhase = "error" | "requesting_approval" | "signing_in";

export function ProvisionDeviceScreen({ navigation, route }: Props) {
    const username = route.params.username;
    const hasLocalDevice = route.params.hasLocalDevice;
    const [phase, setPhase] = useState<ProvisionPhase>(
        hasLocalDevice ? "signing_in" : "requesting_approval",
    );
    const [error, setError] = useState("");
    const spin = useMemo(() => new Animated.Value(0), []);
    const pulse = useMemo(() => new Animated.Value(1), []);
    const rotation = useMemo(
        () =>
            spin.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
            }),
        [spin],
    );

    const runProvisioning = React.useCallback(async () => {
        setError("");
        setPhase(hasLocalDevice ? "signing_in" : "requesting_approval");

        const localResult =
            await vexService.finishPasskeyAuthenticatedDeviceSignIn(
                keychainKeyStore,
            );
        if (localResult.ok) {
            Vibration.vibrate(20);
            return;
        }
        if (!localResult.needsDeviceApproval) {
            setError(
                localResult.error ?? "This device could not finish signing in.",
            );
            setPhase("error");
            return;
        }

        setPhase("requesting_approval");
        const approvalResult =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                mobileConfig(),
                getServerOptions(),
                keychainKeyStore,
            );
        if (
            !approvalResult.ok &&
            approvalResult.pendingDeviceApproval &&
            approvalResult.pendingRequestID
        ) {
            navigation.replace("Authenticate", {
                requestID: approvalResult.pendingRequestID,
                ...(approvalResult.pendingSignKey !== undefined
                    ? { signKey: approvalResult.pendingSignKey }
                    : {}),
                username,
            });
            return;
        }
        if (approvalResult.ok) {
            Vibration.vibrate(20);
            return;
        }
        setError(
            approvalResult.error ??
                "Could not request approval from your other devices.",
        );
        setPhase("error");
    }, [hasLocalDevice, navigation, username]);

    useEffect(() => {
        Animated.loop(
            Animated.timing(spin, {
                duration: 2600,
                easing: Easing.linear,
                toValue: 1,
                useNativeDriver: true,
            }),
        ).start();
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    duration: 950,
                    toValue: 1.08,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    duration: 950,
                    toValue: 1,
                    useNativeDriver: true,
                }),
            ]),
        ).start();
    }, [pulse, spin]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await runProvisioning();
            if (cancelled) {
                return;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [runProvisioning]);

    const heading =
        phase === "signing_in"
            ? "Opening this device."
            : phase === "requesting_approval"
              ? "Requesting approval."
              : "Sign-in paused.";
    const body =
        phase === "signing_in"
            ? `Passkey verified for @${username}. Checking this phone's Vex device key.`
            : phase === "requesting_approval"
              ? `Passkey verified for @${username}. We'll ask one of your signed-in devices to add this phone.`
              : error;

    return (
        <ScreenLayout style={styles.layout}>
            <View pointerEvents="none" style={styles.blackoutLayer} />
            <View style={styles.content}>
                <Animated.View
                    style={[
                        styles.logoWrap,
                        {
                            transform: [{ rotate: rotation }, { scale: pulse }],
                        },
                    ]}
                >
                    <VexLogo size={42} />
                </Animated.View>
                <Text style={styles.eyebrow}>PASSKEY VERIFIED</Text>
                <Text style={styles.heading}>{heading}</Text>
                <Text style={styles.body}>{body}</Text>

                {phase === "error" ? (
                    <View style={styles.actions}>
                        <VexButton
                            glow
                            onPress={() => {
                                void runProvisioning();
                            }}
                            title="Retry"
                            variant="primary"
                        />
                        <VexButton
                            onPress={() => {
                                navigation.replace("HangTight", {
                                    force: true,
                                });
                            }}
                            title="Back to sign in"
                            variant="outline"
                        />
                    </View>
                ) : null}
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    actions: {
        gap: 12,
        marginTop: 22,
        width: "100%",
    },
    blackoutLayer: {
        ...StyleSheet.absoluteFill,
        backgroundColor: "#000000",
        opacity: 0.72,
    },
    body: {
        ...typography.body,
        color: "rgba(255,255,255,0.66)",
        lineHeight: 21,
        marginTop: 10,
        textAlign: "center",
    },
    content: {
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 18,
    },
    eyebrow: {
        ...typography.label,
        color: "rgba(255,255,255,0.5)",
        marginTop: 22,
    },
    heading: {
        ...typography.heading,
        color: colors.text,
        marginTop: 8,
        textAlign: "center",
    },
    layout: {
        backgroundColor: "#000000",
    },
    logoWrap: {
        alignItems: "center",
        justifyContent: "center",
    },
});
