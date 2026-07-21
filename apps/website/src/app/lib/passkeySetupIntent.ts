import type { PasskeyUpgradeReason } from "@vex-chat/store";

export const PASSKEY_SETUP_INTENT_EVENT = "vex-passkey-setup-intent";

const PASSKEY_SETUP_INTENT_KEY = "vex-passkey-setup-intent";

interface PasskeySetupIntent {
    reason: PasskeyUpgradeReason;
    suggestedName: string;
}

export function rememberPasskeySetupIntent(intent: PasskeySetupIntent): void {
    sessionStorage.setItem(PASSKEY_SETUP_INTENT_KEY, JSON.stringify(intent));
    window.dispatchEvent(new Event(PASSKEY_SETUP_INTENT_EVENT));
}

export function takePasskeySetupIntent(
    fallbackName: string,
): PasskeySetupIntent | null {
    const raw = sessionStorage.getItem(PASSKEY_SETUP_INTENT_KEY);
    sessionStorage.removeItem(PASSKEY_SETUP_INTENT_KEY);
    if (!raw) return null;
    const fallback: PasskeySetupIntent = {
        reason: "password_login",
        suggestedName: fallbackName.trim() || "This browser",
    };
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return fallback;
        const candidate = parsed as {
            reason?: unknown;
            suggestedName?: unknown;
        };
        return {
            reason:
                candidate.reason === "cross_platform_passkey"
                    ? candidate.reason
                    : "password_login",
            suggestedName:
                typeof candidate.suggestedName === "string" &&
                candidate.suggestedName.trim()
                    ? candidate.suggestedName.trim()
                    : fallback.suggestedName,
        };
    } catch {
        return fallback;
    }
}
