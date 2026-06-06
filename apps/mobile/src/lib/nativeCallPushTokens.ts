import type { PushNotificationChannel } from "@vex-chat/store";

import * as SecureStore from "expo-secure-store";
import { atom } from "nanostores";

const NATIVE_CALL_PUSH_TOKEN_KEY = "vex.nativeCallPushToken.v1";

export interface NativeCallPushToken {
    channel: Extract<PushNotificationChannel, "apnsVoip" | "fcmCall">;
    token: string;
}

export const $nativeCallPushToken = atom<NativeCallPushToken | null>(null);

export async function clearNativeCallPushToken(): Promise<void> {
    $nativeCallPushToken.set(null);
    await SecureStore.deleteItemAsync(NATIVE_CALL_PUSH_TOKEN_KEY).catch(() => {
        // Best-effort. A stale token will be overwritten on the next native
        // registration event.
    });
}

export async function hydrateNativeCallPushToken(): Promise<void> {
    try {
        const raw = await SecureStore.getItemAsync(NATIVE_CALL_PUSH_TOKEN_KEY);
        const parsed = parseNativeCallPushToken(raw);
        $nativeCallPushToken.set(parsed);
    } catch {
        $nativeCallPushToken.set(null);
    }
}

export async function storeNativeCallPushToken(
    input: NativeCallPushToken,
): Promise<void> {
    const normalized = normalizeNativeCallPushToken(input);
    if (!normalized) {
        return;
    }
    $nativeCallPushToken.set(normalized);
    await SecureStore.setItemAsync(
        NATIVE_CALL_PUSH_TOKEN_KEY,
        JSON.stringify(normalized),
    );
}

function normalizeNativeCallPushToken(
    input: NativeCallPushToken,
): NativeCallPushToken | null {
    const token = input.token.trim();
    if (token.length === 0) {
        return null;
    }
    if (input.channel !== "apnsVoip" && input.channel !== "fcmCall") {
        return null;
    }
    return { channel: input.channel, token };
}

function parseNativeCallPushToken(
    raw: null | string,
): NativeCallPushToken | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }
        const channel = (parsed as { channel?: unknown }).channel;
        const token = (parsed as { token?: unknown }).token;
        if (
            (channel === "apnsVoip" || channel === "fcmCall") &&
            typeof token === "string" &&
            token.trim().length > 0
        ) {
            return { channel, token: token.trim() };
        }
    } catch {
        return null;
    }
    return null;
}
