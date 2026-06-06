import type { Message } from "@vex-chat/libvex";
import type { BackgroundNetworkFetchResult } from "@vex-chat/store";
import type * as Notifications from "expo-notifications";

import { AppState } from "react-native";

import {
    $familiars,
    $groupMessages,
    $incomingCalls,
    $messages,
    vexService,
} from "@vex-chat/store";

import { showIncomingNativeCall } from "./nativeCallUi";
import { showMessageNotification } from "./notifications";
import { runtimeNotifiedMailIDs } from "./runtimeNotificationDedupe";

const BACKGROUND_NOTIFICATION_LIMIT = 8;

export async function runBackgroundSyncFromTask(
    source: "background-fetch" | "background-push",
): Promise<BackgroundNetworkFetchResult> {
    try {
        const knownMailIDsBeforeSync = collectKnownMailIDs();
        const knownIncomingCallIDsBeforeSync = collectKnownIncomingCallIDs();
        const result = await vexService.runBackgroundNetworkFetch();
        console.info("[vex-push] background sync result", {
            result,
            source,
        });
        if (result === "new_data" && AppState.currentState !== "active") {
            await notifyIncomingCallsDownloadedInBackground(
                knownIncomingCallIDsBeforeSync,
            );
            await notifyMessagesDownloadedInBackground(knownMailIDsBeforeSync);
        }
        return result;
    } catch (err: unknown) {
        console.warn(
            "[vex-push] background sync failed",
            err instanceof Error ? err.message : String(err),
        );
        return "failed";
    }
}

export function summarizeBackgroundNotificationTaskPayload(
    payload: Notifications.NotificationTaskPayload,
): Record<string, unknown> {
    if (isNotificationResponsePayload(payload)) {
        const data = payload.notification.request.content.data as Record<
            string,
            unknown
        >;
        return {
            actionIdentifier: payload.actionIdentifier,
            callID: data["callID"],
            event: data["event"],
            keys: Object.keys(data).sort(),
            kind: data["kind"],
            mailID: data["mailID"],
            payloadType: "response",
        };
    }

    const rawData = payload.data;
    const parsedDataString = parseDataString(rawData["dataString"]);
    return {
        callID: rawData["callID"] ?? parsedDataString?.["callID"],
        event: rawData["event"] ?? parsedDataString?.["event"],
        keys: Object.keys(rawData).sort(),
        kind: rawData["kind"] ?? parsedDataString?.["kind"],
        mailID: rawData["mailID"] ?? parsedDataString?.["mailID"],
        parsedDataStringKeys: parsedDataString
            ? Object.keys(parsedDataString).sort()
            : [],
        payloadType: "delivery",
    };
}

function collectKnownIncomingCallIDs(): Set<string> {
    return new Set(Object.keys($incomingCalls.get()));
}

function collectKnownMailIDs(): Set<string> {
    const known = new Set<string>();
    const directMessages = $messages.get();
    const groupMessages = $groupMessages.get();
    for (const thread of Object.values(directMessages)) {
        for (const msg of thread) {
            known.add(msg.mailID);
        }
    }
    for (const thread of Object.values(groupMessages)) {
        for (const msg of thread) {
            known.add(msg.mailID);
        }
    }
    return known;
}

function collectLatestMessagesByThread(
    threads: Record<string, Message[]>,
    knownBefore: Set<string>,
): Message[] {
    const latest: Message[] = [];
    for (const thread of Object.values(threads)) {
        for (let i = thread.length - 1; i >= 0; i -= 1) {
            const candidate = thread[i];
            if (!candidate) {
                continue;
            }
            if (
                knownBefore.has(candidate.mailID) ||
                runtimeNotifiedMailIDs.has(candidate.mailID)
            ) {
                continue;
            }
            latest.push(candidate);
            break;
        }
    }
    return latest;
}

function isNotificationResponsePayload(
    payload: Notifications.NotificationTaskPayload,
): payload is Notifications.NotificationResponse {
    return "actionIdentifier" in payload;
}

async function notifyIncomingCallsDownloadedInBackground(
    knownBeforeSync: Set<string>,
): Promise<void> {
    const familiars = $familiars.get();
    for (const event of Object.values($incomingCalls.get())) {
        if (knownBeforeSync.has(event.call.callID)) {
            continue;
        }
        await showIncomingNativeCall(
            event,
            familiars[event.fromUserID]?.username ?? undefined,
        );
    }
}

async function notifyMessagesDownloadedInBackground(
    knownBeforeSync: Set<string>,
): Promise<void> {
    const directLatest = collectLatestMessagesByThread(
        $messages.get(),
        knownBeforeSync,
    );
    const groupLatest = collectLatestMessagesByThread(
        $groupMessages.get(),
        knownBeforeSync,
    );
    const candidates = [...directLatest, ...groupLatest]
        .sort(
            (a, b) =>
                (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
        )
        .slice(-BACKGROUND_NOTIFICATION_LIMIT);
    for (const msg of candidates) {
        runtimeNotifiedMailIDs.add(msg.mailID);
        await showMessageNotification(msg);
    }
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
