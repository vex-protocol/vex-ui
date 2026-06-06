import * as SecureStore from "expo-secure-store";

const NATIVE_CALL_ACTION_QUEUE_KEY = "vex.nativeCallActions.v1";
const MAX_NATIVE_CALL_ACTIONS = 8;

export interface NativeCallAction {
    callID: string;
    kind: NativeCallActionKind;
    queuedAt: number;
}

export type NativeCallActionKind = "answer" | "end";

export async function drainNativeCallActions(): Promise<NativeCallAction[]> {
    const actions = await readNativeCallActions();
    await SecureStore.deleteItemAsync(NATIVE_CALL_ACTION_QUEUE_KEY).catch(
        () => {
            // Best-effort; stale actions are time-bounded below.
        },
    );
    const cutoff = Date.now() - 90_000;
    return actions.filter((action) => action.queuedAt >= cutoff);
}

export async function enqueueNativeCallAction(input: {
    callID: string;
    kind: NativeCallActionKind;
}): Promise<void> {
    const callID = input.callID.trim();
    if (callID.length === 0) {
        return;
    }
    const actions = await readNativeCallActions();
    const next = [
        ...actions.filter(
            (action) => action.callID !== callID || action.kind !== input.kind,
        ),
        { callID, kind: input.kind, queuedAt: Date.now() },
    ].slice(-MAX_NATIVE_CALL_ACTIONS);
    await SecureStore.setItemAsync(
        NATIVE_CALL_ACTION_QUEUE_KEY,
        JSON.stringify(next),
    );
}

export function isNativeCallNotificationData(
    data: Record<string, unknown> | undefined,
): data is Record<string, unknown> {
    return data?.["kind"] === "voiceCall" || data?.["event"] === "callWake";
}

export function parseNativeCallNotificationAction(
    data: Record<string, unknown> | undefined,
    actionID: string | undefined,
): null | { callID: string; kind: NativeCallActionKind } {
    if (!isNativeCallNotificationData(data)) {
        return null;
    }
    const callID = data["callID"];
    if (typeof callID !== "string" || callID.trim().length === 0) {
        return null;
    }
    if (actionID === "vex-call-answer") {
        return { callID: callID.trim(), kind: "answer" };
    }
    if (actionID === "vex-call-decline" || actionID === "vex-call-hangup") {
        return { callID: callID.trim(), kind: "end" };
    }
    return null;
}

function parseNativeCallAction(value: unknown): NativeCallAction[] {
    if (typeof value !== "object" || value === null) {
        return [];
    }
    const action = value as Record<string, unknown>;
    if (
        typeof action["callID"] === "string" &&
        (action["kind"] === "answer" || action["kind"] === "end") &&
        typeof action["queuedAt"] === "number"
    ) {
        return [
            {
                callID: action["callID"],
                kind: action["kind"],
                queuedAt: action["queuedAt"],
            },
        ];
    }
    return [];
}

async function readNativeCallActions(): Promise<NativeCallAction[]> {
    try {
        const raw = await SecureStore.getItemAsync(
            NATIVE_CALL_ACTION_QUEUE_KEY,
        );
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.flatMap(parseNativeCallAction);
    } catch {
        return [];
    }
}
