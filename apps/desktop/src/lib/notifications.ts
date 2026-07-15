import type { Message } from "@vex-chat/libvex";

import { $groupMessages, $messages, shouldNotify } from "@vex-chat/store";

import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    isPermissionGranted,
    requestPermission as requestNativePermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";

import { playNotify } from "./sounds.js";

// ── Preference ──────────────────────────────────────────────────────────────

const NOTIF_KEY = "vex-notifications-enabled";

export function getNotificationsEnabled(): boolean {
    return localStorage.getItem(NOTIF_KEY) !== "false";
}

export async function requestNotificationAccess(): Promise<boolean> {
    try {
        if (await isPermissionGranted()) return true;
        return (await requestNativePermission()) === "granted";
    } catch (error) {
        console.error("Could not request desktop notification access", error);
        return false;
    }
}

export async function sendTestNotification(): Promise<boolean> {
    if (!(await requestNotificationAccess())) return false;
    sendNotification({
        body: "Desktop notifications are working.",
        title: "Vex",
    });
    return true;
}

export function setNotificationsEnabled(enabled: boolean): void {
    localStorage.setItem(NOTIF_KEY, String(enabled));
}

// ── Atom-based notification watcher ─────────────────────────────────────────

/**
 * Subscribes to message atoms and fires desktop notifications for new messages.
 * Returns an unsubscribe function.
 */
export function setupNotifications(
    resolveAuthorName?: (userID: string) => string | undefined,
    resolveChannelInfo?: (
        channelID: string,
    ) => undefined | { channelName: string; serverName: string },
): () => void {
    let prevDmSnapshot = $messages.get();
    let prevGroupSnapshot = $groupMessages.get();

    const handleNewMessage = async (msg: Message): Promise<void> => {
        let focused = false;
        try {
            focused = await getCurrentWindow().isFocused();
        } catch {}

        const payload = shouldNotify(
            msg,
            resolveAuthorName,
            resolveChannelInfo,
        );
        if (!payload) return;
        if (!getNotificationsEnabled()) return;

        playNotify();

        if (!focused || !isConversationVisible(msg)) {
            const granted = await requestNotificationAccess();
            if (granted) {
                sendNotification({
                    body: `${payload.subtitle}\n${payload.body}`,
                    title: payload.title,
                });
            }
        }
    };

    const unsubDm = $messages.subscribe((next) => {
        for (const [threadKey, msgs] of Object.entries(next)) {
            const prev = prevDmSnapshot[threadKey] ?? [];
            if (msgs.length > prev.length) {
                const newMsg = msgs[msgs.length - 1];
                if (newMsg) void handleNewMessage(newMsg);
            }
        }
        prevDmSnapshot = next;
    });

    const unsubGroup = $groupMessages.subscribe((next) => {
        for (const [channelID, msgs] of Object.entries(next)) {
            const prev = prevGroupSnapshot[channelID] ?? [];
            if (msgs.length > prev.length) {
                const newMsg = msgs[msgs.length - 1];
                if (newMsg) void handleNewMessage(newMsg);
            }
        }
        prevGroupSnapshot = next;
    });

    return () => {
        unsubDm();
        unsubGroup();
    };
}

function isConversationVisible(msg: Message): boolean {
    const route = window.location.hash.slice(1).split("?")[0] ?? "";
    if (msg.group) {
        const parts = route.split("/");
        return parts[1] === "server" && parts[3] === msg.group;
    }
    return route === `/messaging/${msg.authorID}`;
}
