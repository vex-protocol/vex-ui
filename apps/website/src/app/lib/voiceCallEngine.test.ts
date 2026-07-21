import type { CallEvent } from "@vex-chat/libvex";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vexService } from "@vex-chat/store";

import { $voiceCallState, voiceCallEngine } from "./voiceCallEngine";

const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
);
const originalPeerConnection = Object.getOwnPropertyDescriptor(
    globalThis,
    "RTCPeerConnection",
);
const originalSessionDescription = Object.getOwnPropertyDescriptor(
    globalThis,
    "RTCSessionDescription",
);

let audioTrack: { enabled: boolean; stop: ReturnType<typeof vi.fn> };

describe("voiceCallEngine", () => {
    beforeEach(() => {
        audioTrack = { enabled: true, stop: vi.fn() };
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: {
                mediaDevices: {
                    getUserMedia: vi.fn(() =>
                        Promise.resolve({
                            getAudioTracks: () => [audioTrack],
                            getTracks: () => [audioTrack],
                        }),
                    ),
                },
            },
        });
        Object.defineProperty(globalThis, "RTCPeerConnection", {
            configurable: true,
            value: FakePeerConnection,
        });
        Object.defineProperty(globalThis, "RTCSessionDescription", {
            configurable: true,
            value: FakeSessionDescription,
        });
        vi.spyOn(vexService, "getVoiceIceServers").mockResolvedValue([]);
        vi.spyOn(vexService, "refreshVoiceCalls").mockResolvedValue({
            calls: [],
            ok: true,
        });
        vi.spyOn(vexService, "sendVoiceCallIce").mockResolvedValue({
            ok: true,
        });
        voiceCallEngine.reset();
    });

    afterEach(() => {
        voiceCallEngine.reset();
        vi.restoreAllMocks();
        restoreProperty("navigator", originalNavigator);
        restoreProperty("RTCPeerConnection", originalPeerConnection);
        restoreProperty("RTCSessionDescription", originalSessionDescription);
    });

    it("starts, mutes, and hangs up an outgoing call", async () => {
        vi.spyOn(vexService, "startVoiceCall").mockResolvedValue({
            event: callEvent(),
            ok: true,
        });
        const hangup = vi
            .spyOn(vexService, "hangupVoiceCall")
            .mockResolvedValue({ ok: true });

        await voiceCallEngine.startDmCall("user-b", "Bob");

        expect($voiceCallState.get()).toMatchObject({
            callID: "call-1",
            peerUserID: "user-b",
            peerUsername: "Bob",
            phase: "ringing",
        });
        expect(voiceCallEngine.toggleMute()).toBe(true);
        expect(audioTrack.enabled).toBe(false);

        await voiceCallEngine.hangup();

        expect(hangup).toHaveBeenCalledWith("call-1");
        expect(audioTrack.stop).toHaveBeenCalledOnce();
        expect($voiceCallState.get().phase).toBe("idle");
    });

    it("accepts an incoming offer and closes on a terminal event", async () => {
        const accept = vi
            .spyOn(vexService, "acceptVoiceCall")
            .mockResolvedValue({ ok: true });
        const incoming = callEvent({
            fromUserID: "user-b",
            signal: {
                description: { sdp: "offer", type: "offer" },
                kind: "offer",
            },
        });

        await voiceCallEngine.acceptIncomingCall(incoming, "Bob");

        expect(accept).toHaveBeenCalledOnce();
        expect($voiceCallState.get()).toMatchObject({
            direction: "incoming",
            phase: "active",
        });

        await voiceCallEngine.handleCallEvent(
            callEvent({ action: "hangup", call: { status: "ended" } }),
        );
        expect($voiceCallState.get().phase).toBe("idle");
    });
});

class FakePeerConnection {
    connectionState = "new";
    iceConnectionState = "new";
    localDescription: unknown = null;
    onconnectionstatechange: null | (() => void) = null;
    onicecandidate: null | ((event: { candidate: null }) => void) = null;
    oniceconnectionstatechange: null | (() => void) = null;
    ontrack: null | ((event: unknown) => void) = null;
    remoteDescription: unknown = null;

    addTrack() {}

    close() {
        this.connectionState = "closed";
    }

    createAnswer() {
        return Promise.resolve({ sdp: "answer", type: "answer" });
    }

    createOffer() {
        return Promise.resolve({ sdp: "offer", type: "offer" });
    }

    setLocalDescription(description: unknown) {
        this.localDescription = description;
        return Promise.resolve();
    }

    setRemoteDescription(description: unknown) {
        this.remoteDescription = description;
        return Promise.resolve();
    }
}

function FakeSessionDescription(this: Record<string, unknown>, init: unknown) {
    Object.assign(this, init);
}

function callEvent(
    overrides: Omit<Partial<CallEvent>, "call"> & {
        call?: Partial<CallEvent["call"]>;
    } = {},
): CallEvent {
    const { call: callOverrides, ...eventOverrides } = overrides;
    return {
        action: "invite",
        call: {
            callID: "call-1",
            status: "ringing",
            ...callOverrides,
        },
        fromDeviceID: "device-b",
        fromUserID: "user-b",
        signal: {
            description: { sdp: "offer", type: "offer" },
            kind: "offer",
        },
        ...eventOverrides,
    } as CallEvent;
}

function restoreProperty(
    key: "RTCSessionDescription" | "RTCPeerConnection" | "navigator",
    descriptor: PropertyDescriptor | undefined,
) {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, key);
    }
}
