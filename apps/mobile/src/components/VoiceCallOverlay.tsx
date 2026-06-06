import type { CallEvent } from "@vex-chat/libvex";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { $familiars, $incomingCalls, $latestCallEvent } from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "../lib/haptics";
import {
    endNativeCall,
    showIncomingNativeCall,
    updateNativeCallDisplay,
} from "../lib/nativeCallUi";
import {
    $voiceCallState,
    voiceCallEngine,
    type VoiceCallMediaState,
    type VoiceCallPhase,
} from "../lib/voiceCallEngine";
import { colors, typography } from "../theme";

import { Avatar } from "./Avatar";

type CallAction = "answer" | "end" | "mute";
type IconName = keyof typeof Ionicons.glyphMap;

export function VoiceCallOverlay() {
    const familiars = useStore($familiars);
    const incomingCalls = useStore($incomingCalls);
    const latestCallEvent = useStore($latestCallEvent);
    const callState = useStore($voiceCallState);
    const insets = useSafeAreaInsets();
    const handledEventRef = useRef<CallEvent | null>(null);
    const [busyAction, setBusyAction] = useState<CallAction | null>(null);

    const incomingEvent = useMemo(
        () => Object.values(incomingCalls)[0] ?? null,
        [incomingCalls],
    );
    const hasLiveCall = callState.phase !== "idle";
    const pendingIncomingEvent = hasLiveCall ? null : incomingEvent;
    const peerUserID =
        (hasLiveCall
            ? callState.peerUserID
            : pendingIncomingEvent?.fromUserID) ?? null;
    const peerName =
        (hasLiveCall ? callState.peerUsername : null) ??
        (peerUserID ? familiars[peerUserID]?.username : undefined) ??
        "Vex user";
    const direction = hasLiveCall ? callState.direction : "incoming";
    const visible = hasLiveCall || Boolean(pendingIncomingEvent);
    const isOutgoingStartup =
        direction === "outgoing" &&
        callState.phase === "connecting" &&
        !callState.callID;
    const canEndCall = Boolean(pendingIncomingEvent) || !isOutgoingStartup;
    const callTone =
        callState.error ||
        callState.mediaState === "disconnected" ||
        callState.mediaState === "failed"
            ? "error"
            : pendingIncomingEvent
              ? "incoming"
              : direction === "outgoing"
                ? "outgoing"
                : "active";
    const statusText = callStatusText({
        direction,
        hasLiveCall,
        mediaState: callState.mediaState,
        pendingIncoming: Boolean(pendingIncomingEvent),
        phase: callState.phase,
    });

    useEffect(() => {
        if (!latestCallEvent || handledEventRef.current === latestCallEvent) {
            return;
        }
        handledEventRef.current = latestCallEvent;
        if (isTerminalCallEvent(latestCallEvent)) {
            void endNativeCall(
                latestCallEvent.call.callID,
                latestCallEvent.action === "reject"
                    ? "declined"
                    : latestCallEvent.action === "timeout"
                      ? "missed"
                      : "remoteEnded",
            );
        }
        void voiceCallEngine
            .handleCallEvent(latestCallEvent)
            .catch((err: unknown) => {
                console.warn(
                    "[vex-call] failed to handle signaling event",
                    err instanceof Error ? err.message : String(err),
                );
            });
    }, [latestCallEvent]);

    useEffect(() => {
        if (!incomingEvent) {
            return;
        }
        void showIncomingNativeCall(
            incomingEvent,
            familiars[incomingEvent.fromUserID]?.username ?? undefined,
        );
    }, [familiars, incomingEvent]);

    useEffect(() => {
        if (!callState.callID || !peerName) {
            return;
        }
        void updateNativeCallDisplay(
            callState.callID,
            peerName,
            callState.peerUserID ?? undefined,
        );
    }, [peerName, callState.callID, callState.peerUserID]);

    useEffect(() => {
        if (!visible) {
            setBusyAction(null);
        }
    }, [visible]);

    const answerCall = useCallback(async () => {
        const event = pendingIncomingEvent;
        if (!event || busyAction) {
            return;
        }
        setBusyAction("answer");
        haptic("confirm");
        try {
            await voiceCallEngine.acceptIncomingCall(event, peerName);
        } catch (err: unknown) {
            console.warn(
                "[vex-call] failed to answer in-app call",
                err instanceof Error ? err.message : String(err),
            );
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, peerName, pendingIncomingEvent]);

    const endCall = useCallback(async () => {
        if (busyAction || !canEndCall) {
            return;
        }
        setBusyAction("end");
        haptic("destructive");
        try {
            if (pendingIncomingEvent) {
                await voiceCallEngine.rejectIncomingCall(pendingIncomingEvent);
                return;
            }
            await voiceCallEngine.hangup();
        } catch (err: unknown) {
            console.warn(
                "[vex-call] failed to end in-app call",
                err instanceof Error ? err.message : String(err),
            );
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, canEndCall, pendingIncomingEvent]);

    const toggleMute = useCallback(() => {
        if (busyAction || callState.phase === "idle") {
            return;
        }
        setBusyAction("mute");
        haptic("tap");
        voiceCallEngine.toggleMute();
        setBusyAction(null);
    }, [busyAction, callState.phase]);

    if (!visible) {
        return null;
    }

    return (
        <Modal
            animationType="fade"
            onRequestClose={() => {
                void endCall();
            }}
            presentationStyle="fullScreen"
            statusBarTranslucent
            visible
        >
            <StatusBar
                backgroundColor={colors.bg}
                barStyle="light-content"
                hidden={false}
            />
            <View
                style={[
                    styles.root,
                    {
                        paddingBottom: Math.max(insets.bottom, 24),
                        paddingTop: Math.max(insets.top, 28),
                    },
                ]}
            >
                <View pointerEvents="none" style={styles.topWash} />
                <View pointerEvents="none" style={styles.bottomWash} />
                <View pointerEvents="none" style={styles.grid}>
                    <View style={styles.gridLine} />
                    <View style={styles.gridLine} />
                    <View style={styles.gridLine} />
                </View>

                <View style={styles.header}>
                    <View style={[styles.statusPill, tonePillStyle(callTone)]}>
                        <View
                            style={[styles.statusDot, toneDotStyle(callTone)]}
                        />
                        <Text style={styles.statusPillText}>{statusText}</Text>
                    </View>
                    {callState.mediaError ? (
                        <Text numberOfLines={2} style={styles.mediaWarning}>
                            {callState.mediaError}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.identity}>
                    <View style={styles.avatarStage}>
                        <View style={styles.avatarRingOuter} />
                        <View style={styles.avatarRingInner} />
                        {peerUserID ? (
                            <Avatar
                                displayName={peerName}
                                ring={{
                                    color:
                                        callTone === "incoming"
                                            ? "rgba(110,231,197,0.74)"
                                            : "rgba(255,255,255,0.28)",
                                    width: 2,
                                }}
                                size={156}
                                userID={peerUserID}
                            />
                        ) : (
                            <View style={styles.avatarFallback}>
                                <Ionicons
                                    color={colors.textSecondary}
                                    name="person-outline"
                                    size={58}
                                />
                            </View>
                        )}
                    </View>
                    <Text numberOfLines={1} style={styles.peerName}>
                        {peerName}
                    </Text>
                    <Text style={styles.callType}>Vex Audio</Text>
                    {callState.error ? (
                        <Text numberOfLines={3} style={styles.errorText}>
                            {callState.error}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.controls}>
                    {pendingIncomingEvent ? (
                        <View style={styles.primaryControls}>
                            <CallControl
                                busy={busyAction === "end"}
                                color={colors.error}
                                icon="call-outline"
                                label="Decline"
                                onPress={() => {
                                    void endCall();
                                }}
                                rotate={135}
                            />
                            <CallControl
                                busy={busyAction === "answer"}
                                color={colors.success}
                                icon="call"
                                label="Answer"
                                onPress={() => {
                                    void answerCall();
                                }}
                            />
                        </View>
                    ) : (
                        <View style={styles.primaryControls}>
                            <CallControl
                                active={callState.muted}
                                color={
                                    callState.muted
                                        ? "rgba(231,0,0,0.32)"
                                        : "rgba(255,255,255,0.16)"
                                }
                                icon={
                                    callState.muted
                                        ? "mic-off-outline"
                                        : "mic-outline"
                                }
                                label={callState.muted ? "Muted" : "Mute"}
                                onPress={toggleMute}
                                secondary
                            />
                            <CallControl
                                busy={busyAction === "end"}
                                color={colors.error}
                                disabled={!canEndCall}
                                icon="call"
                                label={
                                    direction === "outgoing" ? "Cancel" : "End"
                                }
                                onPress={() => {
                                    void endCall();
                                }}
                                rotate={135}
                            />
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

function CallControl({
    active = false,
    busy = false,
    color,
    disabled = false,
    icon,
    label,
    onPress,
    rotate = 0,
    secondary = false,
}: {
    active?: boolean;
    busy?: boolean;
    color: string;
    disabled?: boolean;
    icon: IconName;
    label: string;
    onPress: () => void;
    rotate?: number;
    secondary?: boolean;
}) {
    return (
        <View style={styles.controlWrap}>
            <Pressable
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled, selected: active }}
                disabled={busy || disabled}
                onPress={onPress}
                style={({ pressed }) => [
                    styles.controlButton,
                    secondary ? styles.secondaryButton : null,
                    { backgroundColor: color },
                    disabled && styles.controlDisabled,
                    pressed && styles.controlPressed,
                ]}
            >
                {busy ? (
                    <ActivityIndicator color={colors.text} size="small" />
                ) : (
                    <Ionicons
                        color={secondary ? colors.text : "#fff"}
                        name={icon}
                        size={30}
                        style={
                            rotate
                                ? { transform: [{ rotate: `${rotate}deg` }] }
                                : null
                        }
                    />
                )}
            </Pressable>
            <Text style={styles.controlLabel}>{label}</Text>
        </View>
    );
}

function callStatusText({
    direction,
    hasLiveCall,
    mediaState,
    pendingIncoming,
    phase,
}: {
    direction: "incoming" | "outgoing" | null;
    hasLiveCall: boolean;
    mediaState: VoiceCallMediaState;
    pendingIncoming: boolean;
    phase: VoiceCallPhase;
}): string {
    if (pendingIncoming) {
        return "Incoming call";
    }
    if (!hasLiveCall) {
        return "Voice call";
    }
    if (phase === "error") {
        return "Call failed";
    }
    if (phase === "active") {
        switch (mediaState) {
            case "connected":
                return "Connected";
            case "connecting":
            case "idle":
                return "Connecting media";
            case "disconnected":
                return "Media interrupted";
            case "failed":
                return "Media failed";
            case "signaling-only":
                return "Connected - signaling only";
        }
    }
    if (phase === "ringing") {
        return direction === "outgoing" ? "Ringing" : "Incoming call";
    }
    if (phase === "connecting") {
        return direction === "outgoing" ? "Calling" : "Connecting";
    }
    return "Voice call";
}

function isTerminalCallEvent(event: CallEvent): boolean {
    return (
        event.action === "cancel" ||
        event.action === "end" ||
        event.action === "hangup" ||
        event.action === "reject" ||
        event.action === "timeout" ||
        event.call.status === "ended"
    );
}

function toneDotStyle(tone: "active" | "error" | "incoming" | "outgoing") {
    if (tone === "error") {
        return styles.dotError;
    }
    if (tone === "incoming") {
        return styles.dotIncoming;
    }
    if (tone === "outgoing") {
        return styles.dotOutgoing;
    }
    return styles.dotActive;
}

function tonePillStyle(tone: "active" | "error" | "incoming" | "outgoing") {
    if (tone === "error") {
        return styles.pillError;
    }
    if (tone === "incoming") {
        return styles.pillIncoming;
    }
    if (tone === "outgoing") {
        return styles.pillOutgoing;
    }
    return styles.pillActive;
}

const styles = StyleSheet.create({
    avatarFallback: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
        borderColor: "rgba(255,255,255,0.24)",
        borderRadius: 78,
        borderWidth: 1,
        height: 156,
        justifyContent: "center",
        width: 156,
    },
    avatarRingInner: {
        borderColor: "rgba(255,255,255,0.16)",
        borderRadius: 92,
        borderWidth: 1,
        height: 184,
        position: "absolute",
        width: 184,
    },
    avatarRingOuter: {
        borderColor: "rgba(231,0,0,0.22)",
        borderRadius: 112,
        borderWidth: 1,
        height: 224,
        position: "absolute",
        width: 224,
    },
    avatarStage: {
        alignItems: "center",
        height: 232,
        justifyContent: "center",
        width: 232,
    },
    bottomWash: {
        backgroundColor: "rgba(231,0,0,0.10)",
        bottom: 0,
        height: "30%",
        left: 0,
        position: "absolute",
        right: 0,
    },
    callType: {
        ...typography.body,
        color: colors.muted,
        marginTop: 8,
    },
    controlButton: {
        alignItems: "center",
        borderRadius: 38,
        height: 76,
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { height: 10, width: 0 },
        shadowOpacity: 0.36,
        shadowRadius: 18,
        width: 76,
    },
    controlDisabled: {
        opacity: 0.42,
    },
    controlLabel: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: 12,
        textAlign: "center",
    },
    controlPressed: {
        opacity: 0.76,
        transform: [{ scale: 0.96 }],
    },
    controls: {
        alignItems: "center",
        paddingBottom: 6,
        width: "100%",
    },
    controlWrap: {
        alignItems: "center",
        minWidth: 102,
    },
    dotActive: {
        backgroundColor: colors.success,
    },
    dotError: {
        backgroundColor: colors.error,
    },
    dotIncoming: {
        backgroundColor: colors.successText,
    },
    dotOutgoing: {
        backgroundColor: colors.accentMuted,
    },
    errorText: {
        ...typography.body,
        color: colors.dangerText,
        marginTop: 18,
        maxWidth: 320,
        textAlign: "center",
    },
    grid: {
        ...StyleSheet.absoluteFill,
        justifyContent: "space-evenly",
        opacity: 0.18,
    },
    gridLine: {
        backgroundColor: "rgba(255,255,255,0.12)",
        height: StyleSheet.hairlineWidth,
        width: "100%",
    },
    header: {
        alignItems: "center",
        minHeight: 82,
        paddingHorizontal: 24,
        width: "100%",
    },
    identity: {
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 28,
        width: "100%",
    },
    mediaWarning: {
        ...typography.body,
        color: colors.infoText,
        marginTop: 12,
        maxWidth: 320,
        textAlign: "center",
    },
    peerName: {
        ...typography.heading,
        color: colors.text,
        marginTop: 26,
        maxWidth: "100%",
        textAlign: "center",
    },
    pillActive: {
        borderColor: "rgba(0,184,135,0.35)",
    },
    pillError: {
        borderColor: colors.dangerBorder,
    },
    pillIncoming: {
        borderColor: "rgba(110,231,197,0.42)",
    },
    pillOutgoing: {
        borderColor: "rgba(255,107,107,0.42)",
    },
    primaryControls: {
        alignItems: "flex-start",
        flexDirection: "row",
        gap: 34,
        justifyContent: "center",
        width: "100%",
    },
    root: {
        alignItems: "center",
        backgroundColor: colors.bg,
        flex: 1,
        justifyContent: "space-between",
        overflow: "hidden",
        paddingHorizontal: 20,
    },
    secondaryButton: {
        borderColor: "rgba(255,255,255,0.18)",
        borderWidth: 1,
    },
    statusDot: {
        borderRadius: 4,
        height: 8,
        width: 8,
    },
    statusPill: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: "row",
        gap: 9,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    statusPillText: {
        ...typography.label,
        color: colors.textSecondary,
    },
    topWash: {
        backgroundColor: "rgba(255,255,255,0.04)",
        height: "28%",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
    },
});
