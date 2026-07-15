import type {
    CallEvent,
    CallSession,
    CallSignalPayload,
} from "@vex-chat/libvex";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
    $activeCallsWritable,
    $currentCallIDWritable,
    $incomingCallsWritable,
    $latestCallEventWritable,
} from "../domains/calls.ts";
import { $userWritable } from "../domains/identity.ts";
import { vexService } from "../service.ts";

const now = "2026-06-01T00:00:00.000Z";
const later = "2026-06-01T00:01:00.000Z";
const offer: CallSignalPayload = {
    description: { sdp: "v=0", type: "offer" },
    kind: "offer",
};

function installClient(
    events: {
        accept?: CallEvent;
        active?: CallSession[];
        hangup?: CallEvent;
        reject?: CallEvent;
        startDM?: CallEvent;
    } = {},
) {
    const calls = {
        accept: vi.fn(
            async () => events.accept ?? makeEvent({ action: "accept" }),
        ),
        active: vi.fn(async () => events.active ?? []),
        cancel: vi.fn(async () => makeEvent({ action: "cancel" })),
        hangup: vi.fn(
            async () =>
                events.hangup ??
                makeEvent({
                    action: "hangup",
                    call: makeCall({ endedAt: later, status: "ended" }),
                }),
        ),
        ice: vi.fn(async () => makeEvent({ action: "ice" })),
        iceServers: vi.fn(async () => [{ urls: "stun:localhost:3478" }]),
        reject: vi.fn(
            async () =>
                events.reject ??
                makeEvent({
                    action: "reject",
                    call: makeCall({ endedAt: later, status: "ended" }),
                }),
        ),
        signal: vi.fn(async () => makeEvent({ action: "signal" })),
        startDM: vi.fn(async () => events.startDM ?? makeEvent()),
    };
    (vexService as unknown as { client: unknown }).client = { calls };
    return calls;
}

function makeCall(overrides: Partial<CallSession> = {}): CallSession {
    return {
        callID: "call-1",
        conversationID: "user-b",
        conversationType: "dm",
        createdAt: now,
        createdBy: "user-a",
        createdByDeviceID: "device-a",
        expiresAt: later,
        media: "audio",
        participants: [
            {
                state: "ringing",
                userID: "user-a",
            },
            {
                state: "invited",
                userID: "user-b",
            },
        ],
        status: "ringing",
        ...overrides,
    };
}

function makeEvent(overrides: Partial<CallEvent> = {}): CallEvent {
    return {
        action: "invite",
        call: makeCall(overrides.call),
        fromDeviceID: "device-a",
        fromUserID: "user-a",
        signal: offer,
        ...overrides,
    };
}

function resetClient(): void {
    (vexService as unknown as { client: null }).client = null;
}

describe("vexService voice calls", () => {
    beforeEach(() => {
        vexService.configureProductFeatures({
            premiumTiers: true,
            voiceCalling: true,
        });
        $activeCallsWritable.set({});
        $incomingCallsWritable.set({});
        $currentCallIDWritable.set(null);
        $latestCallEventWritable.set(null);
        $userWritable.set({
            lastSeen: now,
            userID: "user-a",
            username: "alice",
        });
    });

    afterEach(() => {
        vexService.configureProductFeatures({
            premiumTiers: true,
            voiceCalling: true,
        });
        resetClient();
    });

    test("keeps call APIs and state dormant when voice calling is disabled", async () => {
        const calls = installClient();
        $activeCallsWritable.set({ "call-1": makeCall() });
        $incomingCallsWritable.set({ "call-1": makeEvent() });
        $currentCallIDWritable.set("call-1");
        $latestCallEventWritable.set(makeEvent());

        vexService.configureProductFeatures({
            premiumTiers: true,
            voiceCalling: false,
        });

        await expect(
            vexService.startVoiceCall("user-b", offer),
        ).resolves.toEqual({
            error: "Voice calling is disabled in this build.",
            ok: false,
        });
        await expect(vexService.refreshVoiceCalls()).resolves.toEqual({
            calls: [],
            ok: true,
        });
        expect(calls.startDM).not.toHaveBeenCalled();
        expect(calls.active).not.toHaveBeenCalled();
        expect($activeCallsWritable.get()).toEqual({});
        expect($incomingCallsWritable.get()).toEqual({});
        expect($currentCallIDWritable.get()).toBeNull();
        expect($latestCallEventWritable.get()).toBeNull();
    });

    test("starts a DM voice call and stores the returned session", async () => {
        const calls = installClient();

        const result = await vexService.startVoiceCall("user-b", offer);

        expect(result.ok).toBe(true);
        expect(calls.startDM).toHaveBeenCalledWith("user-b", offer);
        expect($activeCallsWritable.get()["call-1"]?.status).toBe("ringing");
        expect($currentCallIDWritable.get()).toBe("call-1");
        expect($incomingCallsWritable.get()).toEqual({});
    });

    test("stores incoming invites without selecting the current call", () => {
        $userWritable.set({
            lastSeen: now,
            userID: "user-b",
            username: "bob",
        });

        (
            vexService as unknown as {
                handleCallEvent(event: CallEvent): void;
            }
        ).handleCallEvent(makeEvent());

        expect($activeCallsWritable.get()["call-1"]?.status).toBe("ringing");
        expect($incomingCallsWritable.get()["call-1"]?.action).toBe("invite");
        expect($currentCallIDWritable.get()).toBeNull();
    });

    test("keeps incoming invites when caller ICE arrives", () => {
        $userWritable.set({
            lastSeen: now,
            userID: "user-b",
            username: "bob",
        });
        const service = vexService as unknown as {
            handleCallEvent(event: CallEvent): void;
        };

        service.handleCallEvent(makeEvent());
        service.handleCallEvent(
            makeEvent({
                action: "ice",
                signal: {
                    candidate: {
                        candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host",
                        sdpMid: "0",
                        sdpMLineIndex: 0,
                    },
                    kind: "ice",
                },
            }),
        );

        expect($incomingCallsWritable.get()["call-1"]?.action).toBe("invite");
        expect($currentCallIDWritable.get()).toBeNull();
    });

    test("accepting a call removes it from incoming and makes it current", async () => {
        $userWritable.set({
            lastSeen: now,
            userID: "user-b",
            username: "bob",
        });
        $incomingCallsWritable.set({ "call-1": makeEvent() });
        installClient({
            accept: makeEvent({
                action: "accept",
                call: makeCall({ status: "active" }),
                fromUserID: "user-b",
            }),
        });

        const result = await vexService.acceptVoiceCall("call-1", {
            description: { sdp: "v=0", type: "answer" },
            kind: "answer",
        });

        expect(result.ok).toBe(true);
        expect($activeCallsWritable.get()["call-1"]?.status).toBe("active");
        expect($incomingCallsWritable.get()).toEqual({});
        expect($currentCallIDWritable.get()).toBe("call-1");
    });

    test("terminal call events remove active and incoming state", async () => {
        $activeCallsWritable.set({ "call-1": makeCall() });
        $incomingCallsWritable.set({ "call-1": makeEvent() });
        $currentCallIDWritable.set("call-1");
        installClient();

        const result = await vexService.rejectVoiceCall("call-1");

        expect(result.ok).toBe(true);
        expect($activeCallsWritable.get()).toEqual({});
        expect($incomingCallsWritable.get()).toEqual({});
        expect($currentCallIDWritable.get()).toBeNull();
    });

    test("refreshVoiceCalls replaces active calls and prunes stale incoming calls", async () => {
        const active = makeCall({
            callID: "call-active",
            conversationID: "user-c",
        });
        $incomingCallsWritable.set({
            "call-1": makeEvent(),
            "call-active": makeEvent({ call: active }),
        });
        installClient({ active: [active] });

        const result = await vexService.refreshVoiceCalls();

        expect(result.ok).toBe(true);
        expect(Object.keys($activeCallsWritable.get())).toEqual([
            "call-active",
        ]);
        expect(Object.keys($incomingCallsWritable.get())).toEqual([
            "call-active",
        ]);
    });
});
