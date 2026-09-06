import { normalizeExternalUrl } from "@vex-chat/store";

import { openUrl } from "@tauri-apps/plugin-opener";

export function openExternalUrl(value: unknown): void {
    const url = normalizeExternalUrl(value);
    if (url) void openUrl(url).catch(console.error);
}
