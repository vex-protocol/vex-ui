import type { User } from "@vex-chat/libvex";

import { $user, type AuthResult, vexService } from "@vex-chat/store";

import { getServerOptions, getServerUrl } from "./config";
import { keychainKeyStore, setUserIDForUsername } from "./keychain";
import { mobileConfig } from "./platform";
import { voiceCallEngine } from "./voiceCallEngine";

const LOCAL_DEV_HOST_RE =
    /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|100\.)/i;

export async function handleLocalDevAutomationLink(url: string): Promise<void> {
    if (!isLocalDevAutomationEnabled()) {
        console.warn("[vex-dev] ignoring local automation link outside dev");
        return;
    }

    const parsed = new URL(url);
    const action = parsed.pathname.replace(/^\/+/, "");

    if (action === "register") {
        await registerLocalDevUser(requiredParam(parsed, "username"));
        return;
    }

    if (action === "start-call") {
        await startLocalDevCall(parsed);
        return;
    }

    if (action === "logout") {
        await vexService.logout();
        console.info("[vex-dev] logged out");
        return;
    }

    console.warn("[vex-dev] unknown local automation action", action);
}

export function isLocalDevAutomationLink(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "vex:" && parsed.hostname === "local-dev";
    } catch {
        return false;
    }
}

function assertOk(
    result: AuthResult,
    label: string,
): asserts result is AuthResult & { ok: true } {
    if (!result.ok) {
        throw new Error(result.error ?? `Local dev ${label} failed.`);
    }
}

function isLocalDevAutomationEnabled(): boolean {
    return (
        __DEV__ &&
        process.env["EXPO_PUBLIC_ENABLE_DEV_SERVER"] === "1" &&
        LOCAL_DEV_HOST_RE.test(getServerUrl())
    );
}

async function registerLocalDevUser(username: string): Promise<void> {
    const normalized = username.trim().toLowerCase();
    if (!normalized) {
        throw new Error("Missing local dev username.");
    }

    await vexService.logout().catch(() => undefined);
    const result = await vexService.register(
        normalized,
        "",
        mobileConfig(),
        getServerOptions(),
        keychainKeyStore,
    );
    assertOk(result, `register @${normalized}`);

    const user = $user.get();
    if (user) {
        await setUserIDForUsername(user.username, user.userID).catch(
            () => undefined,
        );
    }
    console.info("[vex-dev] registered", {
        userID: user?.userID ?? null,
        username: user?.username ?? normalized,
    });
}

function requiredParam(parsed: URL, name: string): string {
    const value = parsed.searchParams.get(name)?.trim();
    if (!value) {
        throw new Error(`Missing local dev parameter: ${name}.`);
    }
    return value;
}

async function resolveCallTarget(parsed: URL): Promise<User> {
    const userID = parsed.searchParams.get("userID")?.trim();
    const username = parsed.searchParams.get("username")?.trim();

    if (userID) {
        const user = await vexService.lookupUser(userID);
        if (user) return user;
        return {
            lastSeen: new Date(0).toISOString(),
            userID,
            username: username ?? userID,
        };
    }

    if (!username) {
        throw new Error("Missing local dev call target.");
    }

    const user = await vexService.lookupUser(username);
    if (!user) {
        throw new Error(`Could not find @${username}.`);
    }
    return user;
}

async function startLocalDevCall(parsed: URL): Promise<void> {
    const target = await resolveCallTarget(parsed);
    await voiceCallEngine.startDmCall(target.userID, target.username);
    console.info("[vex-dev] started call", {
        userID: target.userID,
        username: target.username,
    });
}
