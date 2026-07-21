import type { CallEvent } from "@vex-chat/libvex";

import { Mic, MicOff, PhoneCall, PhoneOff, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { $familiars, $incomingCalls, $latestCallEvent } from "@vex-chat/store";

import {
    $voiceCallState,
    voiceCallEngine,
    type VoiceCallMediaState,
    type VoiceCallPhase,
} from "../lib/voiceCallEngine";
import { useStoreValue } from "../lib/useStoreValue";
import { Avatar } from "./Avatar";

export function VoiceCallOverlay() {
    const familiars = useStoreValue($familiars);
    const incomingCalls = useStoreValue($incomingCalls);
    const latestEvent = useStoreValue($latestCallEvent);
    const callState = useStoreValue($voiceCallState);
    const handledEvent = useRef<CallEvent | null>(null);
    const [busyCallID, setBusyCallID] = useState("");
    const [localError, setLocalError] = useState("");
    const incoming = Object.values(incomingCalls)[0] ?? null;
    const incomingName = incoming
        ? (familiars[incoming.fromUserID]?.username ?? "Vex user")
        : "";
    const peerName =
        callState.peerUsername ??
        (callState.peerUserID
            ? (familiars[callState.peerUserID]?.username ?? "Vex user")
            : "Vex call");
    const callVisible = !["error", "idle"].includes(callState.phase);
    const error = localError || callState.error || callState.mediaError;

    useEffect(() => {
        if (!latestEvent || handledEvent.current === latestEvent) return;
        handledEvent.current = latestEvent;
        void voiceCallEngine
            .handleCallEvent(latestEvent)
            .catch((cause: unknown) => {
                setLocalError(errorMessage(cause));
            });
    }, [latestEvent]);

    useEffect(
        () => () => {
            voiceCallEngine.reset();
        },
        [],
    );

    async function accept(event: CallEvent) {
        setBusyCallID(event.call.callID);
        setLocalError("");
        try {
            await voiceCallEngine.acceptIncomingCall(
                event,
                familiars[event.fromUserID]?.username,
            );
        } catch (cause: unknown) {
            setLocalError(errorMessage(cause));
        } finally {
            setBusyCallID("");
        }
    }

    async function reject(event: CallEvent) {
        setBusyCallID(event.call.callID);
        setLocalError("");
        try {
            await voiceCallEngine.rejectIncomingCall(event);
        } catch (cause: unknown) {
            setLocalError(errorMessage(cause));
        } finally {
            setBusyCallID("");
        }
    }

    async function hangup() {
        setLocalError("");
        try {
            await voiceCallEngine.hangup();
        } catch (cause: unknown) {
            setLocalError(errorMessage(cause));
        }
    }

    function dismissError() {
        setLocalError("");
        voiceCallEngine.dismissError();
    }

    if (!incoming && !callVisible && !error) return null;

    return (
        <aside aria-label="Voice call" className="voice-call-overlay">
            {incoming && callState.phase === "idle" ? (
                <section className="voice-call-panel is-incoming">
                    <Avatar
                        name={incomingName}
                        size={38}
                        userID={incoming.fromUserID}
                    />
                    <span className="voice-call-panel__copy">
                        <strong>{incomingName}</strong>
                        <small>Incoming voice call</small>
                    </span>
                    <div className="voice-call-panel__actions">
                        <button
                            aria-label="Decline voice call"
                            className="voice-call-button is-danger"
                            disabled={busyCallID === incoming.call.callID}
                            title="Decline"
                            type="button"
                            onClick={() => void reject(incoming)}
                        >
                            <PhoneOff size={18} />
                        </button>
                        <button
                            aria-label="Accept voice call"
                            className="voice-call-button is-accept"
                            disabled={busyCallID === incoming.call.callID}
                            title="Accept"
                            type="button"
                            onClick={() => void accept(incoming)}
                        >
                            <PhoneCall size={18} />
                        </button>
                    </div>
                </section>
            ) : null}

            {callVisible ? (
                <section className="voice-call-panel">
                    {callState.peerUserID ? (
                        <Avatar
                            name={peerName}
                            size={38}
                            userID={callState.peerUserID}
                        />
                    ) : (
                        <span className="voice-call-panel__placeholder">
                            <PhoneCall size={19} />
                        </span>
                    )}
                    <span className="voice-call-panel__copy">
                        <strong>{peerName}</strong>
                        <small>
                            {phaseLabel(callState.phase, callState.mediaState)}
                        </small>
                    </span>
                    <div className="voice-call-panel__actions">
                        <button
                            aria-label={
                                callState.muted
                                    ? "Unmute microphone"
                                    : "Mute microphone"
                            }
                            aria-pressed={callState.muted}
                            className="voice-call-button"
                            title={callState.muted ? "Unmute" : "Mute"}
                            type="button"
                            onClick={() => voiceCallEngine.toggleMute()}
                        >
                            {callState.muted ? (
                                <MicOff size={18} />
                            ) : (
                                <Mic size={18} />
                            )}
                        </button>
                        <button
                            aria-label="End voice call"
                            className="voice-call-button is-danger"
                            title="End call"
                            type="button"
                            onClick={() => void hangup()}
                        >
                            <PhoneOff size={18} />
                        </button>
                    </div>
                </section>
            ) : null}

            {error ? (
                <div className="voice-call-error" role="alert">
                    <span>{error}</span>
                    <button
                        aria-label="Dismiss call error"
                        title="Dismiss"
                        type="button"
                        onClick={dismissError}
                    >
                        <X size={15} />
                    </button>
                </div>
            ) : null}
        </aside>
    );
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error && cause.message
        ? cause.message
        : "Voice call failed.";
}

function phaseLabel(
    phase: VoiceCallPhase,
    mediaState: VoiceCallMediaState,
): string {
    if (phase === "ringing") return "Ringing";
    if (phase === "connecting") return "Connecting";
    if (phase !== "active") return "";
    if (mediaState === "connected") return "Connected";
    if (mediaState === "disconnected") return "Reconnecting";
    if (mediaState === "failed") return "Media unavailable";
    return "Connecting media";
}
