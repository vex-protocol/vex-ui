import type { CallEvent } from "@vex-chat/libvex";

import { useEffect, useMemo, useRef } from "react";

import { $familiars, $incomingCalls, $latestCallEvent } from "@vex-chat/store";

import { useStore } from "@nanostores/react";

import {
    endNativeCall,
    showIncomingNativeCall,
    updateNativeCallDisplay,
} from "../lib/nativeCallUi";
import { $voiceCallState, voiceCallEngine } from "../lib/voiceCallEngine";

export function VoiceCallOverlay() {
    const familiars = useStore($familiars);
    const incomingCalls = useStore($incomingCalls);
    const latestCallEvent = useStore($latestCallEvent);
    const callState = useStore($voiceCallState);
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

    const activePeerName =
        callState.peerUsername ??
        (callState.peerUserID
            ? (familiars[callState.peerUserID]?.username ?? "Vex user")
            : "Vex call");

    useEffect(() => {
        if (!callState.callID || !activePeerName) {
            return;
        }
        void updateNativeCallDisplay(
            callState.callID,
            activePeerName,
            callState.peerUserID ?? undefined,
        );
    }, [activePeerName, callState.callID, callState.peerUserID]);

    return null;
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
