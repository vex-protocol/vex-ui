import type { Message } from "@vex-chat/libvex";

import {
    $channels,
    $familiars,
    $groupMessages,
    $hydrationStatus,
    $messages,
    $user,
} from "@vex-chat/store";

import { useEffect, useRef } from "preact/hooks";

import {
    playNotificationSound,
    showBrowserNotification,
} from "./browserNotifications";
import { channelPath, dmPath, navigate } from "./router";
import { useStoreValue } from "./useStoreValue";

const RECENT_PER_CONVERSATION = 8;
const MAX_SEEN_MESSAGES = 2500;

export function useIncomingNotifications(): void {
    const currentUser = useStoreValue($user);
    const familiars = useStoreValue($familiars);
    const channels = useStoreValue($channels);
    const hydration = useStoreValue($hydrationStatus);
    const directMessages = useStoreValue($messages);
    const groupMessages = useStoreValue($groupMessages);
    const initialized = useRef(false);
    const seen = useRef(new Set<string>());
    const seenOrder = useRef<string[]>([]);

    useEffect(() => {
        if (!hydration.ready) return;
        const candidates: NotificationCandidate[] = [];
        for (const [peerID, messages] of Object.entries(directMessages)) {
            for (const message of recent(messages)) {
                candidates.push({ kind: "dm", message, peerID });
            }
        }
        for (const [channelID, messages] of Object.entries(groupMessages)) {
            for (const message of recent(messages)) {
                candidates.push({ channelID, kind: "channel", message });
            }
        }

        const next = candidates
            .filter(({ message }) => !seen.current.has(message.mailID))
            .sort(
                (a, b) =>
                    new Date(a.message.timestamp).getTime() -
                    new Date(b.message.timestamp).getTime(),
            );
        for (const candidate of next) remember(candidate.message.mailID);

        if (!initialized.current) {
            initialized.current = true;
            return;
        }
        if (
            !currentUser ||
            (document.visibilityState === "visible" && document.hasFocus())
        ) {
            return;
        }

        for (const candidate of next) {
            if (candidate.message.authorID === currentUser.userID) continue;
            const body = preview(candidate.message.message);
            if (candidate.kind === "dm") {
                const peer = familiars[candidate.peerID];
                const title = peer?.username ?? "New direct message";
                showBrowserNotification(
                    title,
                    { body, tag: `vex-mail-${candidate.message.mailID}` },
                    () => navigate(dmPath(candidate.peerID)),
                );
                playNotificationSound();
                continue;
            }

            const location = findChannel(channels, candidate.channelID);
            const author = familiars[candidate.message.authorID]?.username;
            showBrowserNotification(
                location ? `#${location.channelName}` : "New group message",
                {
                    body: author ? `${author}: ${body}` : body,
                    tag: `vex-mail-${candidate.message.mailID}`,
                },
                () => {
                    if (location) {
                        navigate(
                            channelPath(location.serverID, candidate.channelID),
                        );
                    }
                },
            );
            playNotificationSound();
        }
    }, [
        channels,
        currentUser,
        directMessages,
        familiars,
        groupMessages,
        hydration.ready,
    ]);

    function remember(mailID: string) {
        if (seen.current.has(mailID)) return;
        seen.current.add(mailID);
        seenOrder.current.push(mailID);
        while (seenOrder.current.length > MAX_SEEN_MESSAGES) {
            const oldest = seenOrder.current.shift();
            if (oldest) seen.current.delete(oldest);
        }
    }
}

type NotificationCandidate =
    | { kind: "dm"; message: Message; peerID: string }
    | { channelID: string; kind: "channel"; message: Message };

function recent(messages: Message[]): Message[] {
    return messages.slice(-RECENT_PER_CONVERSATION);
}

function findChannel(
    channels: ReturnType<typeof $channels.get>,
    channelID: string,
): null | { channelName: string; serverID: string } {
    for (const [serverID, entries] of Object.entries(channels)) {
        const channel = entries.find((entry) => entry.channelID === channelID);
        if (channel) return { channelName: channel.name, serverID };
    }
    return null;
}

function preview(message: string): string {
    const normalized = message.replace(/\s+/gu, " ").trim();
    if (!normalized) return "New encrypted message";
    return normalized.length > 180
        ? `${normalized.slice(0, 177)}...`
        : normalized;
}
