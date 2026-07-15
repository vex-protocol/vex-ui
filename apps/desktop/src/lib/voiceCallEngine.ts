import type { CallEvent, CallSignalPayload } from "@vex-chat/libvex";

import { $user, vexService } from "@vex-chat/store";

import { atom } from "nanostores";

type CallDirection = "incoming" | "outgoing";

const LOCAL_AUDIO_CAPTURE_TIMEOUT_MS = 4_000;
const CALL_RECONCILE_INTERVAL_MS = 1_500;
const CALL_RECONCILE_TIMEOUT_MS = 70_000;
const MEDIA_CONNECT_TIMEOUT_MS = 30_000;
const MAX_PENDING_INCOMING_ICE_CANDIDATES = 64;
const LOCAL_DEV_SIGNALING_ONLY_MARKER = "a=x-vex-local-dev-signaling-only";

export type VoiceCallMediaState =
    | "connected"
    | "connecting"
    | "disconnected"
    | "failed"
    | "idle"
    | "signaling-only";

export type VoiceCallPhase =
    | "active"
    | "connecting"
    | "error"
    | "idle"
    | "ringing";

export interface VoiceCallState {
    callID: null | string;
    direction: CallDirection | null;
    error: null | string;
    mediaError: null | string;
    mediaState: VoiceCallMediaState;
    muted: boolean;
    peerUserID: null | string;
    peerUsername: null | string;
    phase: VoiceCallPhase;
}

const idleState: VoiceCallState = {
    callID: null,
    direction: null,
    error: null,
    mediaError: null,
    mediaState: "idle",
    muted: false,
    peerUserID: null,
    peerUsername: null,
    phase: "idle",
};

export const $voiceCallState = atom<VoiceCallState>(idleState);

class VoiceCallEngine {
    private callID: null | string = null;
    private callReconcileStartedAt = 0;
    private callReconcileTimer: null | ReturnType<typeof setInterval> = null;
    private localStream: MediaStream | null = null;
    private mediaConnectTimer: null | ReturnType<typeof setTimeout> = null;
    private peerConnection: null | RTCPeerConnection = null;
    private pendingIncomingIce = new Map<string, unknown[]>();
    private pendingLocalIce: CallSignalPayload[] = [];
    private pendingRemoteIce: unknown[] = [];
    private remoteAudio: HTMLAudioElement | null = null;
    private remoteStream: MediaStream | null = null;

    async acceptIncomingCall(
        event: CallEvent,
        peerUsername?: string,
    ): Promise<void> {
        const offer = event.signal;
        if (offer?.kind !== "offer" || !offer.description) {
            throw new Error("Incoming call does not include an offer.");
        }

        this.closeLocal();
        this.callID = event.call.callID;
        this.adoptPendingIncomingIce(event.call.callID);
        this.updateState({
            callID: event.call.callID,
            direction: "incoming",
            error: null,
            muted: false,
            peerUserID: event.fromUserID,
            peerUsername: peerUsername ?? null,
            phase: "connecting",
        });

        try {
            const pc = await this.createPeerConnection(event.call.callID);
            await this.attachLocalAudio(pc);
            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    offer.description as RTCSessionDescriptionInit,
                ),
            );
            await this.flushPendingRemoteIce();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const result = await vexService.acceptVoiceCall(event.call.callID, {
                description: toJson(pc.localDescription ?? answer),
                kind: "answer",
            });
            if (!result.ok) {
                throw new Error(result.error ?? "Failed to accept call.");
            }
            await this.flushPendingLocalIce();
            this.markSessionActive();
        } catch (err: unknown) {
            this.closeLocal();
            this.updateState({ error: errorMessage(err), phase: "error" });
            throw err;
        }
    }

    async handleCallEvent(event: CallEvent): Promise<void> {
        const me = $user.get()?.userID;
        if (me && event.fromUserID === me) {
            return;
        }

        if (isTerminalAction(event.action) || event.call.status === "ended") {
            this.pendingIncomingIce.delete(event.call.callID);
            if (!this.callID || event.call.callID !== this.callID) {
                return;
            }
            this.stopCallReconciliation();
            this.closeLocal();
            return;
        }

        if (!this.callID || event.call.callID !== this.callID) {
            this.queuePendingIncomingIce(event);
            return;
        }

        const signal = event.signal;
        if (!signal) {
            return;
        }
        if (signal.kind === "answer" && signal.description) {
            this.stopCallReconciliation();
            const applied = await this.applyRemoteDescription(
                signal.description,
            );
            if (applied) {
                await this.flushPendingRemoteIce();
                this.markSessionActive();
            } else {
                this.markSignalingOnlySession();
            }
            return;
        }
        if (signal.kind === "ice" && signal.candidate) {
            await this.addRemoteIce(signal.candidate);
            return;
        }
        if (signal.kind === "offer" && signal.description) {
            const applied = await this.applyRemoteDescription(
                signal.description,
            );
            if (!applied) {
                this.markSignalingOnlySession();
                return;
            }
            await this.flushPendingRemoteIce();
            const answer = await this.peerConnection?.createAnswer();
            if (!answer || !this.callID) {
                return;
            }
            await this.peerConnection?.setLocalDescription(answer);
            await vexService.sendVoiceCallSignal(this.callID, {
                description: toJson(
                    this.peerConnection?.localDescription ?? answer,
                ),
                kind: "answer",
            });
        }
    }

    async hangup(): Promise<void> {
        const callID = this.callID;
        this.closeLocal();
        if (callID) {
            await vexService.hangupVoiceCall(callID);
        }
    }

    async rejectIncomingCall(event: CallEvent): Promise<void> {
        this.pendingIncomingIce.delete(event.call.callID);
        await vexService.rejectVoiceCall(event.call.callID);
    }

    async startDmCall(
        recipientUserID: string,
        peerUsername?: string,
    ): Promise<void> {
        this.closeLocal();
        this.updateState({
            callID: null,
            direction: "outgoing",
            error: null,
            muted: false,
            peerUserID: recipientUserID,
            peerUsername: peerUsername ?? null,
            phase: "connecting",
        });

        try {
            const pc = await this.createPeerConnection(null);
            await this.attachLocalAudio(pc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const result = await vexService.startVoiceCall(recipientUserID, {
                description: toJson(pc.localDescription ?? offer),
                kind: "offer",
            });
            if (!result.ok || !result.event) {
                throw new Error(result.error ?? "Failed to start call.");
            }
            this.callID = result.event.call.callID;
            this.updateState({
                callID: result.event.call.callID,
                phase: "ringing",
            });
            this.startCallReconciliation(result.event.call.callID);
            await this.flushPendingLocalIce();
        } catch (err: unknown) {
            this.closeLocal();
            this.updateState({ error: errorMessage(err), phase: "error" });
            throw err;
        }
    }

    toggleMute(): boolean {
        const nextMuted = !$voiceCallState.get().muted;
        for (const track of this.localStream?.getAudioTracks() ?? []) {
            track.enabled = !nextMuted;
        }
        this.updateState({ muted: nextMuted });
        return nextMuted;
    }

    private async addRemoteIce(candidate: unknown): Promise<void> {
        const pc = this.peerConnection;
        if (!pc) {
            return;
        }
        if (!hasRemoteDescription(pc)) {
            this.pendingRemoteIce.push(candidate);
            return;
        }
        await this.addRemoteIceCandidate(pc, candidate);
    }

    private async addRemoteIceCandidate(
        pc: RTCPeerConnection,
        candidate: unknown,
    ): Promise<void> {
        try {
            await pc.addIceCandidate(
                new RTCIceCandidate(candidate as RTCIceCandidateInit),
            );
        } catch (err: unknown) {
            console.warn("[vex-call] failed to add remote ICE candidate", err);
        }
    }

    private adoptPendingIncomingIce(callID: string): void {
        const pending = this.pendingIncomingIce.get(callID);
        if (!pending) {
            return;
        }
        this.pendingRemoteIce.push(...pending);
        this.pendingIncomingIce.delete(callID);
    }

    private async applyRemoteDescription(
        description: unknown,
    ): Promise<boolean> {
        const pc = this.peerConnection;
        if (!pc) {
            return false;
        }
        try {
            await pc.setRemoteDescription(
                new RTCSessionDescription(
                    description as RTCSessionDescriptionInit,
                ),
            );
            return true;
        } catch (err: unknown) {
            if (isLocalDevSignalingOnlyDescription(description)) {
                console.warn(
                    "[vex-call] received local-dev signaling-only SDP; no media connection will be established",
                    err,
                );
                return false;
            }
            this.updateState({
                mediaError: errorMessage(err),
                mediaState: "failed",
            });
            throw err;
        }
    }

    private async attachLocalAudio(pc: RTCPeerConnection): Promise<void> {
        if (!navigator.mediaDevices?.getUserMedia) {
            if (import.meta.env.DEV) {
                console.warn(
                    "[vex-call] microphone capture API is unavailable; continuing without a local audio track",
                );
                addAudioTransceiver(pc);
                return;
            }
            throw new Error("Microphone capture is not available.");
        }
        const stream = await captureLocalAudio();
        if (!stream) {
            addAudioTransceiver(pc);
            return;
        }
        this.localStream = stream;
        for (const track of stream.getTracks()) {
            pc.addTrack(track, stream);
        }
    }

    private attachRemoteAudio(stream: MediaStream): void {
        this.remoteStream = stream;
        if (!this.remoteAudio) {
            this.remoteAudio = new Audio();
            this.remoteAudio.autoplay = true;
        }
        this.remoteAudio.srcObject = stream;
        void this.remoteAudio.play().catch((err: unknown) => {
            console.warn("[vex-call] failed to play remote audio", err);
        });
    }

    private closeLocal(): void {
        this.stopCallReconciliation();
        this.stopMediaConnectTimer();
        this.peerConnection?.close();
        this.peerConnection = null;
        this.callID = null;
        this.pendingLocalIce = [];
        this.pendingRemoteIce = [];
        this.remoteStream = null;
        if (this.remoteAudio) {
            this.remoteAudio.pause();
            this.remoteAudio.srcObject = null;
            this.remoteAudio = null;
        }
        for (const track of this.localStream?.getTracks() ?? []) {
            track.stop();
        }
        this.localStream = null;
        $voiceCallState.set(idleState);
    }

    private async createPeerConnection(
        callID: null | string,
    ): Promise<RTCPeerConnection> {
        const iceServers = await vexService
            .getVoiceIceServers()
            .catch(() => []);
        const pc = new RTCPeerConnection({
            iceServers: iceServers as RTCIceServer[],
        });
        pc.onicecandidate = (event) => {
            const candidate = event.candidate;
            if (!candidate) {
                return;
            }
            const payload: CallSignalPayload = {
                candidate: toJson(candidate),
                kind: "ice",
            };
            const activeCallID = this.callID ?? callID;
            if (!activeCallID) {
                this.pendingLocalIce.push(payload);
                return;
            }
            void vexService.sendVoiceCallIce(activeCallID, payload);
        };
        pc.ontrack = (event) => {
            const stream = event.streams[0] ?? new MediaStream([event.track]);
            this.attachRemoteAudio(stream);
        };
        pc.onconnectionstatechange = () => {
            this.handlePeerConnectionState(pc.connectionState);
        };
        pc.oniceconnectionstatechange = () => {
            this.handleIceConnectionState(pc.iceConnectionState);
        };
        this.peerConnection = pc;
        this.updateState({ mediaError: null, mediaState: "connecting" });
        return pc;
    }

    private async flushPendingLocalIce(): Promise<void> {
        if (!this.callID || this.pendingLocalIce.length === 0) {
            return;
        }
        const pending = this.pendingLocalIce;
        this.pendingLocalIce = [];
        for (const signal of pending) {
            await vexService.sendVoiceCallIce(this.callID, signal);
        }
    }

    private async flushPendingRemoteIce(): Promise<void> {
        const pc = this.peerConnection;
        if (
            !pc ||
            !hasRemoteDescription(pc) ||
            this.pendingRemoteIce.length === 0
        ) {
            return;
        }
        const pending = this.pendingRemoteIce;
        this.pendingRemoteIce = [];
        for (const candidate of pending) {
            await this.addRemoteIceCandidate(pc, candidate);
        }
    }

    private handleIceConnectionState(state: RTCIceConnectionState): void {
        switch (state) {
            case "checking":
                this.markMediaConnecting();
                return;
            case "closed":
                this.stopMediaConnectTimer();
                return;
            case "completed":
            case "connected":
                this.markMediaConnected();
                return;
            case "disconnected":
                this.markMediaDisconnected();
                return;
            case "failed":
                this.markMediaFailed("Voice media connection failed.");
                return;
            case "new":
                return;
        }
    }

    private handlePeerConnectionState(state: RTCPeerConnectionState): void {
        switch (state) {
            case "closed":
                this.stopMediaConnectTimer();
                return;
            case "connected":
                this.markMediaConnected();
                return;
            case "connecting":
            case "new":
                this.markMediaConnecting();
                return;
            case "disconnected":
                this.markMediaDisconnected();
                return;
            case "failed":
                this.markMediaFailed("Voice media connection failed.");
                return;
        }
    }

    private markMediaConnected(): void {
        this.stopMediaConnectTimer();
        this.updateState({ mediaError: null, mediaState: "connected" });
    }

    private markMediaConnecting(): void {
        const state = $voiceCallState.get();
        if (
            state.phase === "idle" ||
            state.mediaState === "connected" ||
            state.mediaState === "failed" ||
            state.mediaState === "signaling-only"
        ) {
            return;
        }
        this.updateState({ mediaError: null, mediaState: "connecting" });
    }

    private markMediaDisconnected(): void {
        const state = $voiceCallState.get();
        if (state.phase === "idle" || state.mediaState === "signaling-only") {
            return;
        }
        this.updateState({
            mediaError: "Voice media connection was interrupted.",
            mediaState: "disconnected",
        });
    }

    private markMediaFailed(message: string): void {
        const state = $voiceCallState.get();
        if (state.phase === "idle" || state.mediaState === "signaling-only") {
            return;
        }
        this.stopMediaConnectTimer();
        this.updateState({ mediaError: message, mediaState: "failed" });
    }

    private markSessionActive(): void {
        this.updateState({ phase: "active" });
        const state = $voiceCallState.get();
        if (state.mediaState === "idle") {
            this.updateState({ mediaError: null, mediaState: "connecting" });
        }
        this.startMediaConnectTimer();
    }

    private markSignalingOnlySession(): void {
        this.stopMediaConnectTimer();
        this.peerConnection?.close();
        this.peerConnection = null;
        this.pendingLocalIce = [];
        this.pendingRemoteIce = [];
        if (this.remoteAudio) {
            this.remoteAudio.pause();
            this.remoteAudio.srcObject = null;
            this.remoteAudio = null;
        }
        for (const track of this.localStream?.getTracks() ?? []) {
            track.stop();
        }
        this.localStream = null;
        this.remoteStream = null;
        this.updateState({
            mediaError: null,
            mediaState: "signaling-only",
            phase: "active",
        });
    }

    private queuePendingIncomingIce(event: CallEvent): void {
        const signal = event.signal;
        if (signal?.kind !== "ice" || !signal.candidate) {
            return;
        }
        const me = $user.get()?.userID;
        if (me && event.fromUserID === me) {
            return;
        }
        const callID = event.call.callID;
        const pending = this.pendingIncomingIce.get(callID) ?? [];
        pending.push(signal.candidate);
        if (pending.length > MAX_PENDING_INCOMING_ICE_CANDIDATES) {
            pending.splice(
                0,
                pending.length - MAX_PENDING_INCOMING_ICE_CANDIDATES,
            );
        }
        this.pendingIncomingIce.set(callID, pending);
    }

    private async reconcileCallState(callID: string): Promise<void> {
        if (this.callID !== callID) {
            this.stopCallReconciliation();
            return;
        }
        if (
            Date.now() - this.callReconcileStartedAt >
            CALL_RECONCILE_TIMEOUT_MS
        ) {
            this.stopCallReconciliation();
            return;
        }

        const result = await vexService.refreshVoiceCalls();
        if (!result.ok) {
            return;
        }
        const call = result.calls?.find((candidate) => {
            return candidate.callID === callID;
        });
        if (call?.status === "active") {
            this.stopCallReconciliation();
            this.markSessionActive();
        }
    }

    private startCallReconciliation(callID: string): void {
        this.stopCallReconciliation();
        this.callReconcileStartedAt = Date.now();
        this.callReconcileTimer = setInterval(() => {
            void this.reconcileCallState(callID);
        }, CALL_RECONCILE_INTERVAL_MS);
        void this.reconcileCallState(callID);
    }

    private startMediaConnectTimer(): void {
        const state = $voiceCallState.get();
        if (
            state.mediaState === "connected" ||
            state.mediaState === "failed" ||
            state.mediaState === "signaling-only"
        ) {
            return;
        }
        this.stopMediaConnectTimer();
        this.mediaConnectTimer = setTimeout(() => {
            const current = $voiceCallState.get();
            if (
                current.phase !== "idle" &&
                current.mediaState !== "connected" &&
                current.mediaState !== "signaling-only"
            ) {
                this.markMediaFailed(
                    "Voice media did not connect. Check microphone permissions, network reachability, or TURN server configuration.",
                );
            }
        }, MEDIA_CONNECT_TIMEOUT_MS);
    }

    private stopCallReconciliation(): void {
        if (!this.callReconcileTimer) {
            return;
        }
        clearInterval(this.callReconcileTimer);
        this.callReconcileTimer = null;
        this.callReconcileStartedAt = 0;
    }

    private stopMediaConnectTimer(): void {
        if (!this.mediaConnectTimer) {
            return;
        }
        clearTimeout(this.mediaConnectTimer);
        this.mediaConnectTimer = null;
    }

    private updateState(patch: Partial<VoiceCallState>): void {
        $voiceCallState.set({ ...$voiceCallState.get(), ...patch });
    }
}

function addAudioTransceiver(pc: RTCPeerConnection): void {
    pc.addTransceiver?.("audio", { direction: "sendrecv" });
}

async function captureLocalAudio(): Promise<MediaStream | null> {
    if (import.meta.env.DEV && navigator.userAgent.includes("HeadlessChrome")) {
        console.warn(
            "[vex-call] headless browser detected; continuing without a local audio track",
        );
        return null;
    }

    const capture = navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
    });
    if (!import.meta.env.DEV) {
        return await capture;
    }

    const result = await Promise.race<"timeout" | MediaStream>([
        capture.catch((err: unknown) => {
            console.warn(
                "[vex-call] local microphone capture failed; continuing without a local audio track",
                err,
            );
            return "timeout" as const;
        }),
        new Promise<"timeout">((resolve) => {
            setTimeout(resolve, LOCAL_AUDIO_CAPTURE_TIMEOUT_MS, "timeout");
        }),
    ]);
    if (result !== "timeout") {
        return result;
    }

    console.warn(
        "[vex-call] local microphone capture timed out; continuing without a local audio track",
    );
    return null;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function hasRemoteDescription(pc: RTCPeerConnection): boolean {
    return pc.remoteDescription !== null;
}

function isLocalDevSignalingOnlyDescription(description: unknown): boolean {
    if (!import.meta.env.DEV) {
        return false;
    }
    if (typeof description !== "object" || description === null) {
        return false;
    }
    const sdp = (description as { sdp?: unknown }).sdp;
    return (
        typeof sdp === "string" &&
        (sdp.includes(LOCAL_DEV_SIGNALING_ONLY_MARKER) ||
            sdp.includes(
                "a=fingerprint:sha-256 97:88:B2:51:42:F7:EE:BD:FA:DB:00:F8:28:CF:52:99:06:47:36:CB:11:DF:B1:80:B4:12:0C:D8:CC:B5:E2:56",
            ))
    );
}

function isTerminalAction(action: CallEvent["action"]): boolean {
    return (
        action === "cancel" ||
        action === "end" ||
        action === "hangup" ||
        action === "reject" ||
        action === "timeout"
    );
}

function toJson(value: unknown): unknown {
    if (typeof value !== "object" || value === null) {
        return value;
    }
    const candidate = value as { toJSON?: () => unknown };
    if (typeof candidate.toJSON === "function") {
        return candidate.toJSON();
    }
    return value;
}

export const voiceCallEngine = new VoiceCallEngine();
