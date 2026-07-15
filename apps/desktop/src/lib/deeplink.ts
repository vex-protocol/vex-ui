import { push } from "svelte-spa-router";

import { parseVexLink } from "@vex-chat/store";

/**
 * Registers the deep-link listener. Returns an unsubscribe function.
 */
export async function setupDeepLinks(): Promise<() => void> {
    if (!("__TAURI_INTERNALS__" in window)) return () => undefined;
    const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const unlisten = await onOpenUrl((urls) => {
        for (const url of urls) {
            handleDeepLink(url);
        }
    });
    return unlisten;
}

function handleDeepLink(url: string): void {
    const link = parseVexLink(url);
    switch (link.type) {
        case "invite":
            void push(`/invite/${link.inviteID}`);
            break;
        case "server":
            void push(`/server/${link.serverID}`);
            break;
        case "user":
            void push(`/messaging/${link.userID}`);
            break;
    }
}
