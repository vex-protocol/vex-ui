import type { ServerOptions } from "@vex-chat/store";

import { $localMessageRetentionDays } from "@vex-chat/store";

import Constants from "expo-constants";

// Production server URL lives in code as a typed constant — never read from
// .env. Production defaults to prod, while the dev APK is identified by
// app.config.js metadata and defaults to the dev API even for OTA updates.
const PROD_SERVER_URL = "api.vex.wtf";
const DEV_SERVER_URL = "dev.vex.wtf";
const DEV_OVERRIDE_FLAG = "EXPO_PUBLIC_ENABLE_DEV_SERVER";

type VexExpoConfig = {
    extra?: {
        vex?: {
            environment?: string;
        };
    };
};

const expoConfig = Constants.expoConfig as null | undefined | VexExpoConfig;
const DEFAULT_SERVER_URL =
    expoConfig?.extra?.vex?.environment === "development"
        ? DEV_SERVER_URL
        : PROD_SERVER_URL;

// Any host that looks like a local/LAN dev target. Used for the release-build
// fail-safe and for deciding when http:// is acceptable.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|100\.)/i;

export function getServerOptions(): ServerOptions {
    const host = getServerUrl();
    const override = readOverride();
    const unsafeByScheme = override?.trim().startsWith("http://") ?? false;
    return {
        host,
        localMessageRetentionDays: $localMessageRetentionDays.get(),
        unsafeHttp: unsafeByScheme || DEV_HOST_RE.test(host),
    };
}

// Server host — no protocol prefix (Client adds http:// or https:// based on unsafeHttp)
export function getServerUrl(): string {
    const override = readOverride();
    const host = normalizeHost(override ?? DEFAULT_SERVER_URL);

    // Fail-safe: a release build must never resolve to a dev host.
    if (!__DEV__ && DEV_HOST_RE.test(host)) {
        throw new Error(
            `[vex] Refusing to start: production build resolved server URL to "${host}". ` +
                `EXPO_PUBLIC_SERVER_URL must not point at a dev address in release builds.`,
        );
    }
    return host;
}

function normalizeHost(raw: string): string {
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            return new URL(trimmed).host.replace(/\/+$/, "");
        } catch {
            const noScheme = trimmed.replace(/^https?:\/\//i, "");
            const firstSegment = noScheme.split("/")[0];
            return (
                trimmed
                    .replace(/^https?:\/\//i, "")
                    .replace(/\/+$/, "")
                    .split("/")[0] ??
                firstSegment ??
                DEFAULT_SERVER_URL
            );
        }
    }
    return trimmed.replace(/\/+$/, "");
}

function readOverride(): string | undefined {
    const allowDevOverride =
        (process.env[DEV_OVERRIDE_FLAG] as string | undefined)?.trim() === "1";
    const raw = (
        process.env["EXPO_PUBLIC_SERVER_URL"] as string | undefined
    )?.trim();
    if (!raw || raw.length === 0) {
        return undefined;
    }
    if (__DEV__ && !allowDevOverride) {
        // Dev defaults to production API unless explicitly opted in.
        return undefined;
    }
    return raw;
}
