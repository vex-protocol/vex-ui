import type { CallEvent } from "@vex-chat/libvex";
import type RNCallKeepDefault from "react-native-callkeep";
import type RNVoipPushNotificationDefault from "react-native-voip-push-notification";

import { PermissionsAndroid, Platform } from "react-native";

import notifee, {
    AndroidCategory,
    AndroidImportance,
    EventType,
} from "@notifee/react-native";
import { validate as isUuid, v5 as uuidv5 } from "uuid";

import {
    drainNativeCallActions,
    enqueueNativeCallAction,
    type NativeCallActionKind,
    parseNativeCallNotificationAction,
} from "./nativeCallActionQueue";
import { storeNativeCallPushToken } from "./nativeCallPushTokens";

const CALL_UUID_NAMESPACE = "7f4047dd-5f65-4c1c-9a2b-75de28475c9f";
const CALL_CHANNEL_ID = "vex-native-calls";
const CALLKEEP_FOREGROUND_CHANNEL_ID = "vex-call-media";
const GENERIC_CALLER_NAME = "Vex call";
const INCOMING_CALL_TITLE = "Incoming voice call";

interface NativeCallHandlers {
    onAnswer(callID: string): Promise<void> | void;
    onEnd(callID: string): Promise<void> | void;
    onMute?(callID: string, muted: boolean): Promise<void> | void;
    onNativeCallPushTokenChanged?(): Promise<void> | void;
    onWakeFromNativePush?(): Promise<void> | void;
}

type RNCallKeepModule = typeof RNCallKeepDefault;
type RNVoipPushNotificationModule = typeof RNVoipPushNotificationDefault;

let nativeHandlers: NativeCallHandlers | null = null;
let callKeepLoad: null | Promise<null | RNCallKeepModule> = null;
let callKeepSetup: null | Promise<void> = null;
let voipPushLoad: null | Promise<null | RNVoipPushNotificationModule> = null;
let nativeCallUiBootstrapped = false;
let nativeCallUiBootstrap: null | Promise<void> = null;
let callChannelReady = false;

const callIDByUUID = new Map<string, string>();
const uuidByCallID = new Map<string, string>();
const callKeepShownCallIDs = new Set<string>();
const fallbackNotificationCallIDs = new Set<string>();
const suppressedNativeEndUUIDs = new Set<string>();

export async function drainQueuedNativeCallActions(): Promise<void> {
    const actions = await drainNativeCallActions();
    for (const action of actions) {
        await dispatchNativeCallAction(action.kind, action.callID);
    }
}

export async function endNativeCall(
    callID: string,
    reason: "declined" | "missed" | "remoteEnded" = "remoteEnded",
): Promise<void> {
    const uuid = uuidByCallID.get(callID);
    await cancelFallbackCallNotification(callID);
    fallbackNotificationCallIDs.delete(callID);
    callKeepShownCallIDs.delete(callID);
    uuidByCallID.delete(callID);
    if (uuid) {
        callIDByUUID.delete(uuid);
    }

    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep || !uuid) {
        return;
    }
    try {
        RNCallKeep.reportEndCallWithUUID(uuid, endReasonCode(reason));
    } catch {
        // Some platforms only allow reportEndCallWithUUID for calls CallKeep
        // still considers active.
    }
    try {
        suppressedNativeEndUUIDs.add(uuid);
        RNCallKeep.endCall(uuid);
    } catch {
        suppressedNativeEndUUIDs.delete(uuid);
        // Already ended or never displayed by the native layer.
    }
}

export async function handleNativeCallBackgroundNotification(
    data: Record<string, unknown> | undefined,
    actionID: string | undefined,
): Promise<boolean> {
    const action = parseNativeCallNotificationAction(data, actionID);
    if (!action) {
        return false;
    }
    await enqueueNativeCallAction(action);
    if (action.kind === "end") {
        await cancelFallbackCallNotification(action.callID);
    }
    return true;
}

export async function markNativeCallActive(callID: string): Promise<void> {
    const uuid = uuidByCallID.get(callID);
    if (!uuid) {
        return;
    }
    await cancelFallbackCallNotification(callID);
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep) {
        return;
    }
    try {
        RNCallKeep.setCurrentCallActive(uuid);
    } catch {
        // Android-only; harmless on iOS.
    }
    try {
        RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid);
    } catch {
        // iOS-only and outgoing-only.
    }
}

export async function setNativeCallMuted(
    callID: string,
    muted: boolean,
): Promise<void> {
    const uuid = uuidByCallID.get(callID);
    if (!uuid) {
        return;
    }
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep) {
        return;
    }
    try {
        RNCallKeep.setMutedCall(uuid, muted);
    } catch {
        // iOS-only.
    }
}

export function setupNativeCallUi(handlers: NativeCallHandlers): () => void {
    nativeHandlers = handlers;
    void bootstrapNativeCallUi();
    void setNativeCallAvailability(true);
    void drainQueuedNativeCallActions();
    return () => {
        if (nativeHandlers === handlers) {
            nativeHandlers = null;
        }
        void setNativeCallAvailability(false);
    };
}

export async function showGenericNativeIncomingCallFromWake(
    callID: string,
): Promise<void> {
    await showIncomingNativeCallByID(callID, {
        displayName: GENERIC_CALLER_NAME,
        handle: "vex-call",
    });
}

export async function showIncomingNativeCall(
    event: CallEvent,
    displayName?: string,
): Promise<void> {
    await showIncomingNativeCallByID(event.call.callID, {
        displayName: displayName ?? GENERIC_CALLER_NAME,
        handle: handleForUserID(event.fromUserID),
    });
}

export async function showOutgoingNativeCall(input: {
    callID: string;
    displayName?: string;
    peerUserID: string;
}): Promise<void> {
    if (Platform.OS === "android") {
        return;
    }
    const uuid = rememberCallUUID(input.callID);
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep) {
        return;
    }
    await ensureCallKeepReady();
    const displayName = input.displayName ?? GENERIC_CALLER_NAME;
    try {
        RNCallKeep.startCall(
            uuid,
            handleForUserID(input.peerUserID),
            displayName,
            "generic",
            false,
        );
        reportNativeOutgoingCallConnecting(RNCallKeep, uuid);
        callKeepShownCallIDs.add(input.callID);
    } catch (err: unknown) {
        console.warn(
            "[vex-call] native outgoing call UI failed",
            err instanceof Error ? err.message : String(err),
        );
    }
}

export async function updateNativeCallDisplay(
    callID: string,
    displayName: string,
    peerUserID?: string,
): Promise<void> {
    const uuid = uuidByCallID.get(callID);
    if (!uuid) {
        return;
    }
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep) {
        return;
    }
    try {
        RNCallKeep.updateDisplay(
            uuid,
            displayName,
            peerUserID ? handleForUserID(peerUserID) : "vex-call",
        );
    } catch {
        // Display updates are cosmetic; keep the call alive.
    }
}

async function bootstrapNativeCallUi(): Promise<void> {
    if (nativeCallUiBootstrapped) {
        return;
    }
    if (!nativeCallUiBootstrap) {
        nativeCallUiBootstrap = (async () => {
            await ensureCallKeepReady();
            await setupVoipPushTokenRegistration();
            nativeCallUiBootstrapped = true;
        })().catch((err: unknown) => {
            nativeCallUiBootstrap = null;
            console.warn(
                "[vex-call] native call UI setup failed",
                err instanceof Error ? err.message : String(err),
            );
        });
    }
    await nativeCallUiBootstrap;
}

async function cancelFallbackCallNotification(callID: string): Promise<void> {
    await notifee
        .cancelNotification(fallbackNotificationID(callID))
        .catch(() => {
            // Best-effort; user may have already dismissed it.
        });
}

async function dispatchNativeCallAction(
    kind: NativeCallActionKind,
    callID: string,
): Promise<void> {
    const handlers = nativeHandlers;
    if (!handlers) {
        await enqueueNativeCallAction({ callID, kind });
        return;
    }
    if (kind === "answer") {
        await handlers.onAnswer(callID);
        return;
    }
    await handlers.onEnd(callID);
}

function endReasonCode(reason: "declined" | "missed" | "remoteEnded"): number {
    switch (reason) {
        case "declined":
            return Platform.OS === "ios" ? 5 : 2;
        case "missed":
            return Platform.OS === "ios" ? 2 : 6;
        case "remoteEnded":
            return 2;
    }
}

async function ensureCallChannel(): Promise<void> {
    if (callChannelReady || Platform.OS !== "android") {
        return;
    }
    await notifee.createChannel({
        id: CALL_CHANNEL_ID,
        importance: AndroidImportance.HIGH,
        name: "Calls",
        vibration: true,
    });
    callChannelReady = true;
}

async function ensureCallKeepReady(): Promise<void> {
    if (!callKeepSetup) {
        callKeepSetup = setupCallKeep();
    }
    await callKeepSetup;
}

function fallbackNotificationID(callID: string): string {
    return `vex-call:${callID}`;
}

function handleForUserID(userID: string): string {
    return `vex:${userID.slice(0, 12)}`;
}

async function handleVoipNotification(notification: object): Promise<void> {
    const payload = notification as Record<string, unknown>;
    const callID = readCallID(payload);
    if (callID) {
        await showGenericNativeIncomingCallFromWake(callID);
    }
    await nativeHandlers?.onWakeFromNativePush?.();
    const completionID = readString(payload, "uuid") ?? callID;
    if (completionID) {
        const VoipPushNotification = await loadVoipPushNotification();
        try {
            VoipPushNotification?.onVoipNotificationCompleted(completionID);
        } catch {
            // Completion handlers only exist when native AppDelegate stored one.
        }
    }
}

function installCallKeepListeners(RNCallKeep: RNCallKeepModule): void {
    RNCallKeep.addEventListener("didReceiveStartCallAction", ({ callUUID }) => {
        if (!callUUID) {
            return;
        }
        reportNativeOutgoingCallConnecting(RNCallKeep, callUUID);
    });
    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => {
        const callID = callIDByUUID.get(callUUID);
        if (callID) {
            void dispatchNativeCallAction("answer", callID);
        }
    });
    RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
        if (suppressedNativeEndUUIDs.delete(callUUID)) {
            return;
        }
        const callID = callIDByUUID.get(callUUID);
        if (callID) {
            void dispatchNativeCallAction("end", callID);
        }
    });
    RNCallKeep.addEventListener(
        "didPerformSetMutedCallAction",
        ({ callUUID, muted }) => {
            const callID = callIDByUUID.get(callUUID);
            if (callID) {
                void nativeHandlers?.onMute?.(callID, muted);
            }
        },
    );
    RNCallKeep.addEventListener("didDisplayIncomingCall", (event) => {
        if (event.error) {
            console.warn("[vex-call] native incoming call display failed", {
                error: event.error,
                errorCode: event.errorCode,
            });
        }
    });
    RNCallKeep.addEventListener(
        "createIncomingConnectionFailed",
        ({ callUUID }) => {
            const callID = callIDByUUID.get(callUUID);
            if (callID) {
                void dispatchNativeCallAction("end", callID);
            }
        },
    );
    RNCallKeep.addEventListener("checkReachability", () => {
        try {
            RNCallKeep.setReachable();
        } catch {
            // Android-only reachability ack.
        }
    });
    RNCallKeep.addEventListener("didLoadWithEvents", (events) => {
        for (const event of events) {
            const data = event.data as { callUUID?: string };
            const callUUID = data?.callUUID;
            if (!callUUID) {
                continue;
            }
            if (event.name === "RNCallKeepPerformAnswerCallAction") {
                const callID = callIDByUUID.get(callUUID);
                if (callID) {
                    void dispatchNativeCallAction("answer", callID);
                }
            }
            if (event.name === "RNCallKeepPerformEndCallAction") {
                const callID = callIDByUUID.get(callUUID);
                if (callID) {
                    void dispatchNativeCallAction("end", callID);
                }
            }
            if (event.name === "RNCallKeepDidReceiveStartCallAction") {
                reportNativeOutgoingCallConnecting(RNCallKeep, callUUID);
            }
        }
    });
    if (Platform.OS === "android") {
        notifee.onForegroundEvent(({ detail, type }) => {
            if (type !== EventType.ACTION_PRESS) {
                return;
            }
            const data = detail.notification?.data as
                | Record<string, unknown>
                | undefined;
            const action = parseNativeCallNotificationAction(
                data,
                detail.pressAction?.id,
            );
            if (action) {
                void dispatchNativeCallAction(action.kind, action.callID);
            }
        });
    }
}

async function loadCallKeep(): Promise<null | RNCallKeepModule> {
    if (Platform.OS === "android") {
        // react-native-callkeep 4.3.x exports overloaded Android methods that
        // TurboModules reject; use the Notifee call notification fallback.
        return null;
    }
    if (!callKeepLoad) {
        callKeepLoad = import("react-native-callkeep")
            .then((mod) => mod.default)
            .catch((err: unknown) => {
                console.warn(
                    "[vex-call] react-native-callkeep unavailable",
                    err instanceof Error ? err.message : String(err),
                );
                return null;
            });
    }
    return callKeepLoad;
}

async function loadVoipPushNotification(): Promise<null | RNVoipPushNotificationModule> {
    if (!voipPushLoad) {
        voipPushLoad = import("react-native-voip-push-notification")
            .then((mod) => mod.default)
            .catch((err: unknown) => {
                console.warn(
                    "[vex-call] VoIP push module unavailable",
                    err instanceof Error ? err.message : String(err),
                );
                return null;
            });
    }
    return voipPushLoad;
}

function readCallID(payload: Record<string, unknown>): null | string {
    const direct = readString(payload, "callID");
    if (direct) {
        return direct;
    }
    const dataString = readString(payload, "dataString");
    if (!dataString) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(dataString);
        if (typeof parsed === "object" && parsed !== null) {
            return readString(parsed as Record<string, unknown>, "callID");
        }
    } catch {
        return null;
    }
    return null;
}

function readString(
    payload: Record<string, unknown>,
    key: string,
): null | string {
    const value = payload[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}

function rememberCallUUID(callID: string): string {
    const existing = uuidByCallID.get(callID);
    if (existing) {
        return existing;
    }
    const uuid = isUuid(callID)
        ? callID.toLowerCase()
        : uuidv5(callID, CALL_UUID_NAMESPACE);
    uuidByCallID.set(callID, uuid);
    callIDByUUID.set(uuid, callID);
    return uuid;
}

function reportNativeOutgoingCallConnecting(
    RNCallKeep: RNCallKeepModule,
    uuid: string,
): void {
    try {
        RNCallKeep.reportConnectingOutgoingCallWithUUID(uuid);
    } catch {
        // iOS-only and advisory; media state still drives the in-app UI.
    }
}

async function setNativeCallAvailability(available: boolean): Promise<void> {
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep || Platform.OS !== "android") {
        return;
    }
    try {
        RNCallKeep.setAvailable(available);
        RNCallKeep.canMakeMultipleCalls(false);
        RNCallKeep.setReachable();
    } catch {
        // Availability is advisory; call display attempts still handle failure.
    }
}

async function setupCallKeep(): Promise<void> {
    const RNCallKeep = await loadCallKeep();
    if (!RNCallKeep) {
        return;
    }

    installCallKeepListeners(RNCallKeep);
    try {
        await RNCallKeep.setup({
            android: {
                additionalPermissions: [
                    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                ],
                alertDescription:
                    "Enable the Vex phone account so incoming calls can use the native call screen.",
                alertTitle: "Enable Vex calls",
                cancelButton: "Not now",
                foregroundService: {
                    channelId: CALLKEEP_FOREGROUND_CHANNEL_ID,
                    channelName: "Vex call audio",
                    notificationIcon: "notification_icon",
                    notificationTitle: "Vex call in progress",
                },
                imageName: "notification_icon",
                okButton: "Enable",
                selfManaged: false,
            },
            ios: {
                appName: "Vex",
                audioSession: {
                    mode: "AVAudioSessionModeVoiceChat",
                },
                includesCallsInRecents: false,
                maximumCallGroups: "1",
                maximumCallsPerCallGroup: "1",
                supportsVideo: false,
            },
        });
    } catch (err: unknown) {
        console.warn(
            "[vex-call] CallKeep setup prompt did not complete",
            err instanceof Error ? err.message : String(err),
        );
    }
    await setNativeCallAvailability(true);
}

async function setupVoipPushTokenRegistration(): Promise<void> {
    if (Platform.OS !== "ios") {
        return;
    }
    const VoipPushNotification = await loadVoipPushNotification();
    if (!VoipPushNotification) {
        return;
    }
    try {
        VoipPushNotification.addEventListener("register", (token) => {
            void storeNativeCallPushToken({
                channel: "apnsVoip",
                token,
            }).then(() => nativeHandlers?.onNativeCallPushTokenChanged?.());
        });
        VoipPushNotification.addEventListener(
            "notification",
            (notification) => {
                void handleVoipNotification(notification);
            },
        );
        VoipPushNotification.addEventListener("didLoadWithEvents", (events) => {
            for (const event of events) {
                if (
                    event.name ===
                    "RNVoipPushRemoteNotificationsRegisteredEvent"
                ) {
                    const token = event.data;
                    if (typeof token === "string") {
                        void storeNativeCallPushToken({
                            channel: "apnsVoip",
                            token,
                        }).then(() =>
                            nativeHandlers?.onNativeCallPushTokenChanged?.(),
                        );
                    }
                }
                if (
                    event.name === "RNVoipPushRemoteNotificationReceivedEvent"
                ) {
                    void handleVoipNotification(event.data);
                }
            }
        });
    } catch (err: unknown) {
        console.warn(
            "[vex-call] VoIP push listener setup failed",
            err instanceof Error ? err.message : String(err),
        );
    }
}

async function showFallbackCallNotification(
    callID: string,
    displayName: string,
): Promise<void> {
    await ensureCallChannel();
    fallbackNotificationCallIDs.add(callID);
    await notifee.displayNotification({
        android: {
            actions: [
                {
                    pressAction: {
                        id: "vex-call-answer",
                        launchActivity: "default",
                    },
                    title: "Answer",
                },
                {
                    pressAction: { id: "vex-call-decline" },
                    title: "Decline",
                },
            ],
            autoCancel: false,
            category: AndroidCategory.CALL,
            channelId: CALL_CHANNEL_ID,
            fullScreenAction: {
                id: "default",
                launchActivity: "default",
            },
            importance: AndroidImportance.HIGH,
            ongoing: true,
            pressAction: {
                id: "default",
                launchActivity: "default",
            },
            smallIcon: "notification_icon",
        },
        body: displayName,
        data: {
            callID,
            event: "callWake",
            kind: "voiceCall",
        },
        id: fallbackNotificationID(callID),
        title: INCOMING_CALL_TITLE,
    });
}

async function showIncomingNativeCallByID(
    callID: string,
    input: { displayName: string; handle: string },
): Promise<void> {
    const uuid = rememberCallUUID(callID);
    if (callKeepShownCallIDs.has(callID)) {
        await updateNativeCallDisplay(callID, input.displayName);
        return;
    }
    const RNCallKeep = await loadCallKeep();
    await ensureCallKeepReady();
    if (RNCallKeep) {
        try {
            RNCallKeep.displayIncomingCall(
                uuid,
                input.handle,
                input.displayName,
                "generic",
                false,
                {
                    ios: {
                        supportsDTMF: false,
                        supportsGrouping: false,
                        supportsHolding: false,
                        supportsUngrouping: false,
                    },
                },
            );
            callKeepShownCallIDs.add(callID);
        } catch (err: unknown) {
            console.warn(
                "[vex-call] native incoming call UI failed",
                err instanceof Error ? err.message : String(err),
            );
        }
    }
    if (Platform.OS === "android") {
        const accountEnabled = RNCallKeep
            ? await RNCallKeep.checkPhoneAccountEnabled().catch(() => false)
            : false;
        if (!RNCallKeep || !accountEnabled) {
            await showFallbackCallNotification(callID, input.displayName);
        }
    }
}
