import type {
    CallEvent,
    CallSignalPayload,
    IceServerConfig,
} from "@vex-chat/libvex";

import { Platform } from "react-native";

import { $user, vexService } from "@vex-chat/store";

import { atom } from "nanostores";

import { isLocalDevServer } from "./config";

const SKIP_LOCAL_AUDIO_CAPTURE_FLAG =
    "EXPO_PUBLIC_VEX_SKIP_LOCAL_AUDIO_CAPTURE";
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

interface AddStreamEventLike {
    stream?: MediaStreamLike;
}

type CallDirection = "incoming" | "outgoing";

interface CandidateEventLike {
    candidate?: unknown;
}

interface MediaStreamLike {
    getAudioTracks?: () => MediaStreamTrackLike[];
    getTracks: () => MediaStreamTrackLike[];
}

interface MediaStreamTrackLike {
    enabled: boolean;
    stop?: () => void;
}

interface PeerConnectionLike {
    addIceCandidate: (candidate: unknown) => Promise<void>;
    addStream?: (stream: MediaStreamLike) => void;
    addTrack?: (track: MediaStreamTrackLike, stream: MediaStreamLike) => void;
    addTransceiver?: (
        trackOrKind: "audio",
        init?: {
            direction?: "inactive" | "recvonly" | "sendonly" | "sendrecv";
        },
    ) => unknown;
    close: () => void;
    connectionState?: string;
    createAnswer: () => Promise<unknown>;
    createOffer: () => Promise<unknown>;
    getSenders?: () => Array<{
        track?: MediaStreamTrackLike | null;
    }>;
    iceConnectionState?: string;
    localDescription?: unknown;
    onaddstream?: ((event: AddStreamEventLike) => void) | null;
    onconnectionstatechange?: (() => void) | null;
    onicecandidate?: ((event: CandidateEventLike) => void) | null;
    oniceconnectionstatechange?: (() => void) | null;
    onsignalingstatechange?: (() => void) | null;
    ontrack?: ((event: TrackEventLike) => void) | null;
    remoteDescription?: unknown;
    setLocalDescription: (description: unknown) => Promise<void>;
    setRemoteDescription: (description: unknown) => Promise<void>;
    signalingState?: string;
}

interface TrackEventLike {
    streams?: MediaStreamLike[];
}

interface WebRTCModuleLike {
    mediaDevices: {
        getUserMedia: (constraints: {
            audio: boolean;
            video: boolean;
        }) => Promise<MediaStreamLike>;
    };
    RTCIceCandidate: new (candidate: unknown) => unknown;
    RTCPeerConnection: new (config: {
        iceServers: IceServerConfig[];
    }) => PeerConnectionLike;
    RTCSessionDescription: new (description: unknown) => unknown;
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
    private localStream: MediaStreamLike | null = null;
    private mediaConnectTimer: null | ReturnType<typeof setTimeout> = null;
    private peerConnection: null | PeerConnectionLike = null;
    private pendingIncomingIce = new Map<string, unknown[]>();
    private pendingLocalIce: CallSignalPayload[] = [];
    private pendingRemoteIce: unknown[] = [];
    private remoteStream: MediaStreamLike | null = null;
    private webrtc: null | WebRTCModuleLike = null;

    async acceptIncomingCall(
        event: CallEvent,
        peerUsername?: string,
    ): Promise<void> {
        const offer = event.signal;
        if (offer?.kind !== "offer" || !offer.description) {
            throw new Error("Incoming call does not include an offer.");
        }

        await this.closeLocal(false);
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

        if (shouldUseSignalingOnlyLocalDevCall()) {
            try {
                const result = await vexService.acceptVoiceCall(
                    event.call.callID,
                    {
                        description: createLocalDevSessionDescription("answer"),
                        kind: "answer",
                    },
                );
                if (!result.ok) {
                    throw new Error(result.error ?? "Failed to accept call.");
                }
                this.markSignalingOnlySession();
                return;
            } catch (err: unknown) {
                await this.closeLocal(false);
                this.updateState({
                    error: errorMessage(err),
                    phase: "error",
                });
                throw err;
            }
        }

        try {
            const pc = await this.createPeerConnection(event.call.callID);
            await this.attachLocalAudio(pc);
            await pc.setRemoteDescription(
                this.createSessionDescription(offer.description),
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
            await this.closeLocal(false);
            this.updateState({
                error: errorMessage(err),
                phase: "error",
            });
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
            await this.closeLocal(false);
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
            if (shouldUseSignalingOnlyLocalDevCall() && !this.peerConnection) {
                this.markSignalingOnlySession();
                return;
            }
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
        await this.closeLocal(false);
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
        await this.closeLocal(false);
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
            if (shouldUseSignalingOnlyLocalDevCall()) {
                const result = await vexService.startVoiceCall(
                    recipientUserID,
                    {
                        description: createLocalDevSessionDescription("offer"),
                        kind: "offer",
                    },
                );
                if (!result.ok || !result.event) {
                    throw new Error(result.error ?? "Failed to start call.");
                }
                this.callID = result.event.call.callID;
                this.updateState({
                    callID: result.event.call.callID,
                    phase: "ringing",
                });
                this.startCallReconciliation(result.event.call.callID);
                return;
            }

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
            await this.closeLocal(false);
            this.updateState({
                error: errorMessage(err),
                phase: "error",
            });
            throw err;
        }
    }

    toggleMute(): boolean {
        const nextMuted = !$voiceCallState.get().muted;
        const tracks =
            this.localStream?.getAudioTracks?.() ??
            this.localStream?.getTracks() ??
            [];
        for (const track of tracks) {
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
        pc: PeerConnectionLike,
        candidate: unknown,
    ): Promise<void> {
        try {
            await pc.addIceCandidate(this.createIceCandidate(candidate));
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
                this.createSessionDescription(description),
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

    private async attachLocalAudio(pc: PeerConnectionLike): Promise<void> {
        if (shouldSkipLocalAudioCapture()) {
            pc.addTransceiver?.("audio", { direction: "sendrecv" });
            return;
        }
        const mod = await this.loadWebRTC();
        const stream = await mod.mediaDevices.getUserMedia({
            audio: true,
            video: false,
        });
        this.localStream = stream;
        const tracks = stream.getTracks();
        if (pc.addTrack) {
            for (const track of tracks) {
                pc.addTrack(track, stream);
            }
            return;
        }
        pc.addStream?.(stream);
    }

    private async closeLocal(resetState: boolean): Promise<void> {
        this.stopCallReconciliation();
        this.stopMediaConnectTimer();
        this.peerConnection?.close();
        this.peerConnection = null;
        this.callID = null;
        this.pendingLocalIce = [];
        this.pendingRemoteIce = [];
        this.remoteStream = null;
        const tracks = this.localStream?.getTracks() ?? [];
        for (const track of tracks) {
            track.stop?.();
        }
        this.localStream = null;
        if (resetState) {
            $voiceCallState.set(idleState);
            return;
        }
        $voiceCallState.set(idleState);
    }

    private createIceCandidate(candidate: unknown): unknown {
        const mod = this.requireWebRTC();
        return new mod.RTCIceCandidate(candidate);
    }

    private async createPeerConnection(
        callID: null | string,
    ): Promise<PeerConnectionLike> {
        const mod = await this.loadWebRTC();
        const iceServers = await vexService
            .getVoiceIceServers()
            .catch(() => []);
        const pc = new mod.RTCPeerConnection({ iceServers });
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
            this.remoteStream = event.streams?.[0] ?? this.remoteStream;
        };
        pc.onaddstream = (event) => {
            this.remoteStream = event.stream ?? this.remoteStream;
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

    private createSessionDescription(description: unknown): unknown {
        const mod = this.requireWebRTC();
        return new mod.RTCSessionDescription(description);
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

    private handleIceConnectionState(state?: string): void {
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
            case undefined:
                return;
            default:
                return;
        }
    }

    private handlePeerConnectionState(state?: string): void {
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
            case undefined:
                return;
            default:
                return;
        }
    }

    private async loadWebRTC(): Promise<WebRTCModuleLike> {
        if (this.webrtc) {
            return this.webrtc;
        }
        const mod = (await import("react-native-webrtc")) as unknown;
        if (!isWebRTCModule(mod)) {
            throw new Error("react-native-webrtc is not available.");
        }
        this.webrtc = mod;
        return mod;
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
        const tracks = this.localStream?.getTracks() ?? [];
        for (const track of tracks) {
            track.stop?.();
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
            if (shouldUseSignalingOnlyLocalDevCall() && !this.peerConnection) {
                this.markSignalingOnlySession();
            } else {
                this.markSessionActive();
            }
        }
    }

    private requireWebRTC(): WebRTCModuleLike {
        if (!this.webrtc) {
            throw new Error("Voice call engine is not initialized.");
        }
        return this.webrtc;
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

function createLocalDevSessionDescription(type: "answer" | "offer"): {
    sdp: string;
    type: "answer" | "offer";
} {
    const sessionID =
        String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    const iceUfrag = Math.random().toString(36).slice(2, 10);
    const icePwd = `${Math.random().toString(36).slice(2)}${Math.random()
        .toString(36)
        .slice(2)}`.padEnd(24, "0");
    const setup = type === "offer" ? "actpass" : "active";
    return {
        sdp: [
            "v=0",
            `o=- ${sessionID} 2 IN IP4 127.0.0.1`,
            "s=-",
            "t=0 0",
            "a=group:BUNDLE 0",
            "a=extmap-allow-mixed",
            "a=msid-semantic: WMS",
            LOCAL_DEV_SIGNALING_ONLY_MARKER,
            "m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8",
            "c=IN IP4 0.0.0.0",
            "a=rtcp:9 IN IP4 0.0.0.0",
            `a=ice-ufrag:${iceUfrag}`,
            `a=ice-pwd:${icePwd}`,
            "a=ice-options:trickle",
            "a=fingerprint:sha-256 97:88:B2:51:42:F7:EE:BD:FA:DB:00:F8:28:CF:52:99:06:47:36:CB:11:DF:B1:80:B4:12:0C:D8:CC:B5:E2:56",
            `a=setup:${setup}`,
            "a=mid:0",
            "a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level",
            "a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
            "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
            "a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid",
            "a=sendrecv",
            "a=rtcp-mux",
            "a=rtpmap:111 opus/48000/2",
            "a=rtcp-fb:111 transport-cc",
            "a=fmtp:111 minptime=10;useinbandfec=1",
            "a=rtpmap:0 PCMU/8000",
            "a=rtpmap:8 PCMA/8000",
            "",
        ].join("\r\n"),
        type,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function hasRemoteDescription(pc: PeerConnectionLike): boolean {
    return pc.remoteDescription !== null && pc.remoteDescription !== undefined;
}

function isLocalDevSignalingOnlyDescription(description: unknown): boolean {
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

function isWebRTCModule(value: unknown): value is WebRTCModuleLike {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Partial<WebRTCModuleLike>;
    return (
        typeof candidate.RTCPeerConnection === "function" &&
        typeof candidate.RTCSessionDescription === "function" &&
        typeof candidate.RTCIceCandidate === "function" &&
        typeof candidate.mediaDevices?.getUserMedia === "function"
    );
}

function shouldSkipLocalAudioCapture(): boolean {
    const override = (
        process.env[SKIP_LOCAL_AUDIO_CAPTURE_FLAG] as string | undefined
    )?.trim();
    if (override === "1") {
        return true;
    }
    if (override === "0") {
        return false;
    }
    return __DEV__ && Platform.OS === "ios" && isLocalDevServer();
}

function shouldUseSignalingOnlyLocalDevCall(): boolean {
    return shouldSkipLocalAudioCapture();
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
