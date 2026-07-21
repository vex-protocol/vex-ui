import type { CallEvent, CallSignalPayload } from "@vex-chat/libvex";

import { $user, vexService } from "@vex-chat/store";

const CALL_RECONCILE_INTERVAL_MS = 1_500;
const CALL_RECONCILE_TIMEOUT_MS = 70_000;
const MEDIA_CONNECT_TIMEOUT_MS = 30_000;
const MAX_PENDING_INCOMING_ICE_CANDIDATES = 64;

export type VoiceCallMediaState =
    | "connected"
    | "connecting"
    | "disconnected"
    | "failed"
    | "idle";

export type VoiceCallPhase =
    | "active"
    | "connecting"
    | "error"
    | "idle"
    | "ringing";

export interface VoiceCallState {
    callID: null | string;
    direction: "incoming" | "outgoing" | null;
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

class StateStore<T> {
    private readonly listeners = new Set<(value: T) => void>();

    constructor(private value: T) {}

    get(): T {
        return this.value;
    }

    set(value: T): void {
        this.value = value;
        for (const listener of this.listeners) listener(value);
    }

    subscribe(listener: (value: T) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

export const $voiceCallState = new StateStore<VoiceCallState>(idleState);

class VoiceCallEngine {
    private callID: null | string = null;
    private callReconcileStartedAt = 0;
    private callReconcileTimer: null | ReturnType<typeof setInterval> = null;
    private localStream: MediaStream | null = null;
    private mediaConnectTimer: null | ReturnType<typeof setTimeout> = null;
    private peerConnection: null | RTCPeerConnection = null;
    private readonly pendingIncomingIce = new Map<string, unknown[]>();
    private pendingLocalIce: CallSignalPayload[] = [];
    private pendingRemoteIce: unknown[] = [];
    private remoteAudio: HTMLAudioElement | null = null;

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
            mediaError: null,
            mediaState: "connecting",
            muted: false,
            peerUserID: event.fromUserID,
            peerUsername: peerUsername ?? null,
            phase: "connecting",
        });

        try {
            const connection = await this.createPeerConnection(
                event.call.callID,
            );
            await this.attachLocalAudio(connection);
            await connection.setRemoteDescription(
                new RTCSessionDescription(
                    offer.description as RTCSessionDescriptionInit,
                ),
            );
            await this.flushPendingRemoteIce();
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            const result = await vexService.acceptVoiceCall(event.call.callID, {
                description: toJSON(connection.localDescription ?? answer),
                kind: "answer",
            });
            if (!result.ok) {
                throw new Error(result.error ?? "Failed to accept call.");
            }
            await this.flushPendingLocalIce();
            this.markSessionActive();
        } catch (cause: unknown) {
            this.closeLocal();
            this.updateState({ error: errorMessage(cause), phase: "error" });
            throw cause;
        }
    }

    dismissError(): void {
        if ($voiceCallState.get().phase === "error") this.closeLocal();
    }

    async handleCallEvent(event: CallEvent): Promise<void> {
        const currentUserID = $user.get()?.userID;
        if (currentUserID && event.fromUserID === currentUserID) return;

        if (isTerminalAction(event.action) || event.call.status === "ended") {
            this.pendingIncomingIce.delete(event.call.callID);
            if (event.call.callID === this.callID) this.closeLocal();
            return;
        }

        if (!this.callID || event.call.callID !== this.callID) {
            this.queuePendingIncomingIce(event);
            return;
        }

        const signal = event.signal;
        if (!signal) return;
        if (signal.kind === "answer" && signal.description) {
            this.stopCallReconciliation();
            await this.applyRemoteDescription(signal.description);
            await this.flushPendingRemoteIce();
            this.markSessionActive();
            return;
        }
        if (signal.kind === "ice" && signal.candidate) {
            await this.addRemoteIce(signal.candidate);
            return;
        }
        if (signal.kind === "offer" && signal.description) {
            await this.applyRemoteDescription(signal.description);
            await this.flushPendingRemoteIce();
            const answer = await this.peerConnection?.createAnswer();
            if (!answer || !this.callID) return;
            await this.peerConnection?.setLocalDescription(answer);
            await vexService.sendVoiceCallSignal(this.callID, {
                description: toJSON(
                    this.peerConnection?.localDescription ?? answer,
                ),
                kind: "answer",
            });
        }
    }

    async hangup(): Promise<void> {
        const callID = this.callID;
        this.closeLocal();
        if (callID) await vexService.hangupVoiceCall(callID);
    }

    async rejectIncomingCall(event: CallEvent): Promise<void> {
        this.pendingIncomingIce.delete(event.call.callID);
        await vexService.rejectVoiceCall(event.call.callID);
    }

    reset(): void {
        this.pendingIncomingIce.clear();
        this.closeLocal();
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
            mediaError: null,
            mediaState: "connecting",
            muted: false,
            peerUserID: recipientUserID,
            peerUsername: peerUsername ?? null,
            phase: "connecting",
        });

        try {
            const connection = await this.createPeerConnection(null);
            await this.attachLocalAudio(connection);
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            const result = await vexService.startVoiceCall(recipientUserID, {
                description: toJSON(connection.localDescription ?? offer),
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
        } catch (cause: unknown) {
            this.closeLocal();
            this.updateState({ error: errorMessage(cause), phase: "error" });
            throw cause;
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
        const connection = this.peerConnection;
        if (!connection) return;
        if (!connection.remoteDescription) {
            this.pendingRemoteIce.push(candidate);
            return;
        }
        await this.addRemoteIceCandidate(connection, candidate);
    }

    private async addRemoteIceCandidate(
        connection: RTCPeerConnection,
        candidate: unknown,
    ): Promise<void> {
        try {
            await connection.addIceCandidate(
                new RTCIceCandidate(candidate as RTCIceCandidateInit),
            );
        } catch (cause: unknown) {
            console.warn(
                "[vex-call] failed to add remote ICE candidate",
                cause,
            );
        }
    }

    private adoptPendingIncomingIce(callID: string): void {
        const pending = this.pendingIncomingIce.get(callID);
        if (!pending) return;
        this.pendingRemoteIce.push(...pending);
        this.pendingIncomingIce.delete(callID);
    }

    private async applyRemoteDescription(description: unknown): Promise<void> {
        if (!this.peerConnection) {
            throw new Error("Voice media connection is not ready.");
        }
        try {
            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    description as RTCSessionDescriptionInit,
                ),
            );
        } catch (cause: unknown) {
            this.updateState({
                mediaError: errorMessage(cause),
                mediaState: "failed",
            });
            throw cause;
        }
    }

    private async attachLocalAudio(
        connection: RTCPeerConnection,
    ): Promise<void> {
        if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
            throw new Error("Microphone capture is not available.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
            },
            video: false,
        });
        this.localStream = stream;
        for (const track of stream.getTracks()) {
            connection.addTrack(track, stream);
        }
    }

    private attachRemoteAudio(stream: MediaStream): void {
        if (!this.remoteAudio) {
            this.remoteAudio = new Audio();
            this.remoteAudio.autoplay = true;
        }
        this.remoteAudio.srcObject = stream;
        void this.remoteAudio.play().catch((cause: unknown) => {
            console.warn("[vex-call] failed to play remote audio", cause);
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
        if (this.remoteAudio) {
            this.remoteAudio.pause();
            this.remoteAudio.srcObject = null;
            this.remoteAudio = null;
        }
        for (const track of this.localStream?.getTracks() ?? []) track.stop();
        this.localStream = null;
        $voiceCallState.set(idleState);
    }

    private async createPeerConnection(
        callID: null | string,
    ): Promise<RTCPeerConnection> {
        if (typeof globalThis.RTCPeerConnection !== "function") {
            throw new Error("Voice calls are not available in this browser.");
        }
        const iceServers = await vexService
            .getVoiceIceServers()
            .catch(() => []);
        const connection = new RTCPeerConnection({
            iceServers: iceServers as RTCIceServer[],
        });
        connection.onicecandidate = ({ candidate }) => {
            if (!candidate) return;
            const payload: CallSignalPayload = {
                candidate: toJSON(candidate),
                kind: "ice",
            };
            const activeCallID = this.callID ?? callID;
            if (!activeCallID) {
                this.pendingLocalIce.push(payload);
                return;
            }
            void vexService.sendVoiceCallIce(activeCallID, payload);
        };
        connection.ontrack = (event) => {
            this.attachRemoteAudio(
                event.streams[0] ?? new MediaStream([event.track]),
            );
        };
        connection.onconnectionstatechange = () => {
            this.handlePeerConnectionState(connection.connectionState);
        };
        connection.oniceconnectionstatechange = () => {
            this.handleIceConnectionState(connection.iceConnectionState);
        };
        this.peerConnection = connection;
        this.updateState({ mediaError: null, mediaState: "connecting" });
        return connection;
    }

    private async flushPendingLocalIce(): Promise<void> {
        if (!this.callID || this.pendingLocalIce.length === 0) return;
        const pending = this.pendingLocalIce;
        this.pendingLocalIce = [];
        for (const signal of pending) {
            await vexService.sendVoiceCallIce(this.callID, signal);
        }
    }

    private async flushPendingRemoteIce(): Promise<void> {
        const connection = this.peerConnection;
        if (
            !connection?.remoteDescription ||
            this.pendingRemoteIce.length === 0
        ) {
            return;
        }
        const pending = this.pendingRemoteIce;
        this.pendingRemoteIce = [];
        for (const candidate of pending) {
            await this.addRemoteIceCandidate(connection, candidate);
        }
    }

    private handleIceConnectionState(state: RTCIceConnectionState): void {
        if (state === "connected" || state === "completed") {
            this.markMediaConnected();
        } else if (state === "checking") {
            this.markMediaConnecting();
        } else if (state === "disconnected") {
            this.markMediaDisconnected();
        } else if (state === "failed") {
            this.markMediaFailed("Voice media connection failed.");
        }
    }

    private handlePeerConnectionState(state: RTCPeerConnectionState): void {
        if (state === "connected") {
            this.markMediaConnected();
        } else if (state === "connecting" || state === "new") {
            this.markMediaConnecting();
        } else if (state === "disconnected") {
            this.markMediaDisconnected();
        } else if (state === "failed") {
            this.markMediaFailed("Voice media connection failed.");
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
            state.mediaState === "failed"
        ) {
            return;
        }
        this.updateState({ mediaError: null, mediaState: "connecting" });
    }

    private markMediaDisconnected(): void {
        if ($voiceCallState.get().phase === "idle") return;
        this.updateState({
            mediaError: "Voice media connection was interrupted.",
            mediaState: "disconnected",
        });
    }

    private markMediaFailed(message: string): void {
        if ($voiceCallState.get().phase === "idle") return;
        this.stopMediaConnectTimer();
        this.updateState({ mediaError: message, mediaState: "failed" });
    }

    private markSessionActive(): void {
        this.updateState({ phase: "active" });
        if ($voiceCallState.get().mediaState === "idle") {
            this.updateState({ mediaError: null, mediaState: "connecting" });
        }
        this.startMediaConnectTimer();
    }

    private queuePendingIncomingIce(event: CallEvent): void {
        const signal = event.signal;
        if (signal?.kind !== "ice" || !signal.candidate) return;
        const currentUserID = $user.get()?.userID;
        if (currentUserID && event.fromUserID === currentUserID) return;
        const pending = this.pendingIncomingIce.get(event.call.callID) ?? [];
        pending.push(signal.candidate);
        if (pending.length > MAX_PENDING_INCOMING_ICE_CANDIDATES) {
            pending.splice(
                0,
                pending.length - MAX_PENDING_INCOMING_ICE_CANDIDATES,
            );
        }
        this.pendingIncomingIce.set(event.call.callID, pending);
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
        if (!result.ok) return;
        if (
            result.calls?.some(
                (call) => call.callID === callID && call.status === "active",
            )
        ) {
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
        if (state.mediaState === "connected" || state.mediaState === "failed") {
            return;
        }
        this.stopMediaConnectTimer();
        this.mediaConnectTimer = setTimeout(() => {
            const current = $voiceCallState.get();
            if (
                current.phase !== "idle" &&
                current.mediaState !== "connected"
            ) {
                this.markMediaFailed(
                    "Voice media did not connect. Check microphone permission and network reachability.",
                );
            }
        }, MEDIA_CONNECT_TIMEOUT_MS);
    }

    private stopCallReconciliation(): void {
        if (this.callReconcileTimer) clearInterval(this.callReconcileTimer);
        this.callReconcileTimer = null;
        this.callReconcileStartedAt = 0;
    }

    private stopMediaConnectTimer(): void {
        if (this.mediaConnectTimer) clearTimeout(this.mediaConnectTimer);
        this.mediaConnectTimer = null;
    }

    private updateState(patch: Partial<VoiceCallState>): void {
        $voiceCallState.set({ ...$voiceCallState.get(), ...patch });
    }
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

function isTerminalAction(action: CallEvent["action"]): boolean {
    return ["cancel", "end", "hangup", "reject", "timeout"].includes(action);
}

function toJSON(value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value;
    const serializable = value as { toJSON?: () => unknown };
    return typeof serializable.toJSON === "function"
        ? serializable.toJSON()
        : value;
}

export const voiceCallEngine = new VoiceCallEngine();
