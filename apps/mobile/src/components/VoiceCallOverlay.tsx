import type { CallEvent } from "@vex-chat/libvex";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { $familiars, $incomingCalls, $latestCallEvent } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    $voiceCallState,
    voiceCallEngine,
    type VoiceCallMediaState,
    type VoiceCallPhase,
} from "../lib/voiceCallEngine";
import { colors, typography } from "../theme";

const CALL_ACCEPT_COLOR = "#16a34a";

export function VoiceCallOverlay() {
    const familiars = useStore($familiars);
    const incomingCalls = useStore($incomingCalls);
    const latestCallEvent = useStore($latestCallEvent);
    const callState = useStore($voiceCallState);
    const insets = useSafeAreaInsets();
    const [busyCallID, setBusyCallID] = useState<null | string>(null);
    const [error, setError] = useState<null | string>(null);
    const handledEventRef = useRef<CallEvent | null>(null);
    const incomingEvent = useMemo(
        () => Object.values(incomingCalls)[0] ?? null,
        [incomingCalls],
    );

    useEffect(() => {
        if (!latestCallEvent || handledEventRef.current === latestCallEvent) {
            return;
        }
        handledEventRef.current = latestCallEvent;
        void voiceCallEngine
            .handleCallEvent(latestCallEvent)
            .catch((err: unknown) => {
                console.warn(
                    "[vex-call] failed to handle signaling event",
                    err instanceof Error ? err.message : String(err),
                );
            });
    }, [latestCallEvent]);

    const incomingName = incomingEvent
        ? (familiars[incomingEvent.fromUserID]?.username ?? "Vex user")
        : null;
    const activePeerName =
        callState.peerUsername ??
        (callState.peerUserID
            ? (familiars[callState.peerUserID]?.username ?? "Vex user")
            : "Vex call");
    const callVisible = callState.phase !== "idle";
    const displayedError = error ?? callState.mediaError;
    const incomingVisible =
        incomingEvent !== null && (callState.phase === "idle" || !callVisible);

    const acceptIncoming = (event: CallEvent) => {
        setBusyCallID(event.call.callID);
        setError(null);
        void voiceCallEngine
            .acceptIncomingCall(
                event,
                familiars[event.fromUserID]?.username ?? undefined,
            )
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                setBusyCallID(null);
            });
    };

    const rejectIncoming = (event: CallEvent) => {
        setBusyCallID(event.call.callID);
        setError(null);
        void voiceCallEngine
            .rejectIncomingCall(event)
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                setBusyCallID(null);
            });
    };

    const hangup = () => {
        setError(null);
        void voiceCallEngine.hangup().catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
        });
    };

    if (!incomingVisible && !callVisible && !displayedError) {
        return null;
    }

    return (
        <View pointerEvents="box-none" style={styles.overlay}>
            {incomingVisible && incomingEvent ? (
                <View
                    style={[
                        styles.panel,
                        styles.incomingPanel,
                        { bottom: Math.max(insets.bottom, 14) + 78 },
                    ]}
                >
                    <View style={styles.copy}>
                        <Text numberOfLines={1} style={styles.title}>
                            {incomingName}
                        </Text>
                        <Text style={styles.subtitle}>Incoming voice call</Text>
                    </View>
                    <View style={styles.actions}>
                        <CallButton
                            accessibilityLabel="Reject voice call"
                            busy={busyCallID === incomingEvent.call.callID}
                            color={colors.error}
                            icon="call"
                            onPress={() => rejectIncoming(incomingEvent)}
                            rotate
                        />
                        <CallButton
                            accessibilityLabel="Accept voice call"
                            busy={busyCallID === incomingEvent.call.callID}
                            color={CALL_ACCEPT_COLOR}
                            icon="call"
                            onPress={() => acceptIncoming(incomingEvent)}
                        />
                    </View>
                </View>
            ) : null}

            {callVisible ? (
                <View
                    style={[
                        styles.panel,
                        styles.callPanel,
                        { bottom: Math.max(insets.bottom, 14) },
                    ]}
                >
                    <View style={styles.copy}>
                        <Text numberOfLines={1} style={styles.title}>
                            {activePeerName}
                        </Text>
                        <Text style={styles.subtitle}>
                            {phaseLabel(callState.phase, callState.mediaState)}
                        </Text>
                    </View>
                    <View style={styles.actions}>
                        <CallButton
                            accessibilityLabel={
                                callState.muted
                                    ? "Unmute microphone"
                                    : "Mute microphone"
                            }
                            color={colors.border}
                            icon={callState.muted ? "mic-off" : "mic"}
                            onPress={() => {
                                voiceCallEngine.toggleMute();
                            }}
                        />
                        <CallButton
                            accessibilityLabel="End voice call"
                            color={colors.error}
                            icon="call"
                            onPress={hangup}
                            rotate
                        />
                    </View>
                </View>
            ) : null}

            {displayedError ? (
                <View
                    style={[
                        styles.errorPanel,
                        { bottom: Math.max(insets.bottom, 14) + 156 },
                    ]}
                >
                    <Text numberOfLines={3} style={styles.errorText}>
                        {displayedError}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function CallButton({
    accessibilityLabel,
    busy = false,
    color,
    icon,
    onPress,
    rotate = false,
}: {
    accessibilityLabel: string;
    busy?: boolean;
    color: string;
    icon: "call" | "mic" | "mic-off";
    onPress: () => void;
    rotate?: boolean;
}) {
    return (
        <TouchableOpacity
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            disabled={busy}
            onPress={onPress}
            style={[styles.callButton, { backgroundColor: color }]}
        >
            {busy ? (
                <ActivityIndicator color={colors.text} size="small" />
            ) : (
                <Ionicons
                    color={colors.text}
                    name={icon}
                    size={20}
                    style={rotate ? styles.rotatedIcon : undefined}
                />
            )}
        </TouchableOpacity>
    );
}

function mediaPhaseLabel(mediaState: VoiceCallMediaState): string {
    switch (mediaState) {
        case "connected":
            return "Connected";
        case "connecting":
        case "idle":
            return "Connecting media";
        case "disconnected":
            return "Reconnecting media";
        case "failed":
            return "Media failed";
        case "signaling-only":
            return "Signaling connected";
    }
}

function phaseLabel(
    phase: VoiceCallPhase,
    mediaState: VoiceCallMediaState,
): string {
    switch (phase) {
        case "active":
            return mediaPhaseLabel(mediaState);
        case "connecting":
            return "Connecting";
        case "error":
            return "Call failed";
        case "idle":
            return "";
        case "ringing":
            return "Ringing";
    }
}

const styles = StyleSheet.create({
    actions: {
        flexDirection: "row",
        gap: 10,
    },
    callButton: {
        alignItems: "center",
        borderRadius: 22,
        height: 44,
        justifyContent: "center",
        width: 44,
    },
    callPanel: {
        borderColor: colors.border,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    errorPanel: {
        alignSelf: "center",
        backgroundColor: "rgba(229, 57, 53, 0.18)",
        borderColor: "rgba(229, 57, 53, 0.42)",
        borderRadius: 8,
        borderWidth: 1,
        left: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
        position: "absolute",
        right: 14,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        fontSize: 12,
    },
    incomingPanel: {
        borderColor: CALL_ACCEPT_COLOR,
    },
    overlay: {
        bottom: 0,
        justifyContent: "flex-end",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
    },
    panel: {
        alignItems: "center",
        alignSelf: "center",
        backgroundColor: "rgba(10, 10, 10, 0.96)",
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 14,
        left: 14,
        minHeight: 64,
        paddingHorizontal: 14,
        paddingVertical: 10,
        position: "absolute",
        right: 14,
    },
    rotatedIcon: {
        transform: [{ rotate: "135deg" }],
    },
    subtitle: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
    },
    title: {
        ...typography.button,
        color: colors.text,
        fontSize: 14,
    },
});
