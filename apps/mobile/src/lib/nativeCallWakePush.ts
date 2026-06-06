import { showGenericNativeIncomingCallFromWake } from "./nativeCallUi";

export async function showNativeCallFromPushData(
    data: Record<string, unknown> | undefined,
): Promise<boolean> {
    const parsedDataString = parseDataString(data?.["dataString"]);
    const event =
        readString(data?.["event"]) ?? readString(parsedDataString?.["event"]);
    const kind =
        readString(data?.["kind"]) ?? readString(parsedDataString?.["kind"]);
    const callID =
        readString(data?.["callID"]) ??
        readString(parsedDataString?.["callID"]);
    if ((event !== "callWake" && kind !== "voiceCall") || !callID) {
        return false;
    }

    await showGenericNativeIncomingCallFromWake(callID);
    return true;
}

function parseDataString(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
