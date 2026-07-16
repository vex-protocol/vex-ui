import type { Message } from "@vex-chat/libvex";

import { $groupMessages, $messages, shouldNotify } from "@vex-chat/store";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { playNotify } from "./sounds.js";

// ── Preference ──────────────────────────────────────────────────────────────

const NOTIF_KEY = "vex-notifications-enabled";

export type NativePermissionState = "denied" | "granted" | "prompt";

export interface NotificationSendResult {
    error?: string;
    ok: boolean;
    settingsRequired?: boolean;
}

export async function getNotificationPermissionState(): Promise<NativePermissionState> {
    return invoke<NativePermissionState>(
        "desktop_notification_permission_state",
    );
}

export function getNotificationsEnabled(): boolean {
    return localStorage.getItem(NOTIF_KEY) !== "false";
}

export async function openNotificationSettings(): Promise<void> {
    await invoke("open_desktop_notification_settings");
}

export async function requestNotificationAccess(): Promise<boolean> {
    try {
        const state = await getNotificationPermissionState();
        if (state === "granted") return true;
        if (state === "denied") return false;
        return (
            (await invoke<NativePermissionState>(
                "request_desktop_notification_permission",
            )) === "granted"
        );
    } catch (error) {
        console.error("Could not request desktop notification access", error);
        return false;
    }
}

export async function sendTestNotification(): Promise<NotificationSendResult> {
    if (!(await requestNotificationAccess())) {
        let settingsRequired = false;
        try {
            settingsRequired =
                (await getNotificationPermissionState()) === "denied";
        } catch {}
        return {
            error: "Notifications are disabled in macOS System Settings.",
            ok: false,
            settingsRequired,
        };
    }
    try {
        await sendNativeNotification(
            "Vex",
            "Desktop notifications are working.",
        );
        return { ok: true };
    } catch (error) {
        console.error("Could not send desktop test notification", error);
        return { error: errorMessage(error), ok: false };
    }
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
                try {
                    await sendNativeNotification(
                        payload.title,
                        `${payload.subtitle}\n${payload.body}`,
                    );
                } catch (error) {
                    console.error("Could not send desktop notification", error);
                }
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

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "macOS could not deliver the notification.";
}

function isConversationVisible(msg: Message): boolean {
    const route = window.location.hash.slice(1).split("?")[0] ?? "";
    if (msg.group) {
        const parts = route.split("/");
        return parts[1] === "server" && parts[3] === msg.group;
    }
    return route === `/messaging/${msg.authorID}`;
}

async function sendNativeNotification(
    title: string,
    body: string,
): Promise<void> {
    await invoke("send_desktop_notification", { body, title });
}
