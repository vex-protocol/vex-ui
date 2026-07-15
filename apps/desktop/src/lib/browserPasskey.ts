import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { getServerIdentity } from "./config.js";

export interface BrowserPasskeyHandoff {
    browserToken: string;
    expiresAt: string;
    requestID: string;
}

export async function authenticateWithBrowserPasskeyHandoff(
    handoff: BrowserPasskeyHandoff,
): Promise<Record<string, unknown>> {
    await openBrowserPasskeyPage(handoff, "authenticate-handoff");
    const expiresAt = Date.parse(handoff.expiresAt);
    while (Date.now() < expiresAt) {
        await sleep(800);
        const response = await pollBrowserAuthentication(handoff);
        if (response) return response;
    }
    throw new Error("Passkey sign-in expired. Start again when you are ready.");
}

export function getBrowserPasskeyHandoff(
    options: unknown,
): BrowserPasskeyHandoff | null {
    if (!isRecord(options)) return null;
    const candidate = options["vexBrowserHandoff"];
    if (!isRecord(candidate)) return null;

    const browserToken = candidate["browserToken"];
    const expiresAt = candidate["expiresAt"];
    const requestID = candidate["requestID"];
    if (
        typeof browserToken !== "string" ||
        browserToken.length < 32 ||
        typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt)) ||
        typeof requestID !== "string" ||
        requestID.length === 0
    ) {
        return null;
    }
    return { browserToken, expiresAt, requestID };
}

export async function openBrowserPasskeyHandoff(
    handoff: BrowserPasskeyHandoff,
): Promise<void> {
    await openBrowserPasskeyPage(handoff, "register-handoff");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

async function openBrowserPasskeyPage(
    handoff: BrowserPasskeyHandoff,
    mode: "authenticate-handoff" | "register-handoff",
): Promise<void> {
    const bridgeUrl = new URL("/cli/passkey", serverOrigin());
    bridgeUrl.hash = new URLSearchParams({
        mode,
        request: handoff.requestID,
        token: handoff.browserToken,
    }).toString();

    const sessionUrl = new URL(bridgeUrl);
    sessionUrl.hash = new URLSearchParams({
        callback: "vex://passkey/complete",
        mode,
        request: handoff.requestID,
        token: handoff.browserToken,
    }).toString();
    try {
        const opened = await invoke<boolean>("open_passkey_browser_session", {
            url: sessionUrl.toString(),
        });
        if (opened) return;
    } catch {
        // The default browser remains the portable fallback.
    }
    await openUrl(bridgeUrl.toString());
}

async function pollBrowserAuthentication(
    handoff: BrowserPasskeyHandoff,
): Promise<null | Record<string, unknown>> {
    const statusUrl = new URL(
        `/auth/passkey/browser-authentication/${encodeURIComponent(handoff.requestID)}/status`,
        serverOrigin(),
    );
    statusUrl.searchParams.set("format", "json");
    const response = await globalThis.fetch(statusUrl, {
        body: JSON.stringify({ token: handoff.browserToken }),
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        method: "POST",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.status === 202) return null;
    if (!response.ok) {
        const error =
            isRecord(payload) && typeof payload["error"] === "string"
                ? payload["error"]
                : `Passkey sign-in failed (${String(response.status)}).`;
        throw new Error(error);
    }
    if (!isRecord(payload) || !isRecord(payload["response"])) {
        throw new Error("Passkey sign-in returned an invalid response.");
    }
    return payload["response"];
}

function serverOrigin(): string {
    const configured = getServerIdentity().trim().replace(/\/+$/, "");
    const withScheme = /^https?:\/\//i.test(configured)
        ? configured
        : `https://${configured}`;
    return new URL(withScheme).origin;
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
