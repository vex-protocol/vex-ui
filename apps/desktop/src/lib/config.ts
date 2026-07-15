/**
 * Runtime configuration helpers.
 */
import type { ServerOptions } from "@vex-chat/store";

const SERVER_URL_KEY = "vex-server-url";

export type DesktopAppEnvironment = "development" | "production";

// Flavor server URLs live in code as typed constants. Build scripts select the
// flavor explicitly instead of relying on a potentially stale shell env.
const PROD_SERVER_URL = "api.vex.wtf";
const DEV_SERVER_URL = "dev.vex.wtf";
const VITE_DEV_SERVER_URL = "localhost:5180";

const APP_ENVIRONMENT = resolveAppEnvironment();

// Any host that looks like a local/LAN dev target. Used for the release-build
// fail-safe and for deciding when http:// is acceptable.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|100\.)/i;

const envServerUrl =
    typeof import.meta.env.VITE_SERVER_URL === "string"
        ? import.meta.env.VITE_SERVER_URL.trim()
        : "";
const envProxyTarget =
    typeof import.meta.env.VITE_PROXY_TARGET === "string"
        ? import.meta.env.VITE_PROXY_TARGET.trim()
        : "";
const DEFAULT_SERVER_URL: string =
    envServerUrl.length > 0
        ? normalizeHost(envServerUrl)
        : APP_ENVIRONMENT === "development"
          ? import.meta.env.DEV
              ? VITE_DEV_SERVER_URL
              : DEV_SERVER_URL
          : PROD_SERVER_URL;

// Flavor builds are pinned to their environment. Users can still override the
// server later through Settings, but a mislabeled artifact must fail to build.
if (
    APP_ENVIRONMENT === "production" &&
    (isNonProductionHost(DEFAULT_SERVER_URL) ||
        (envProxyTarget.length > 0 && isNonProductionHost(envProxyTarget)))
) {
    throw new Error(
        `[vex] Refusing to start: production build resolved default server URL to "${DEFAULT_SERVER_URL}". ` +
            `VITE_SERVER_URL must not point at a dev address in release builds.`,
    );
}

if (
    APP_ENVIRONMENT === "development" &&
    !import.meta.env.DEV &&
    hostOnly(DEFAULT_SERVER_URL) !== DEV_SERVER_URL
) {
    throw new Error(
        `[vex] Refusing to start: development build resolved default server URL to "${DEFAULT_SERVER_URL}". ` +
            `VITE_SERVER_URL must point at ${DEV_SERVER_URL}.`,
    );
}

export function clearSession(): void {
    localStorage.removeItem(SERVER_URL_KEY);
}

export function getDesktopAppEnvironment(): DesktopAppEnvironment {
    return APP_ENVIRONMENT;
}

/**
 * Stable server identity for scoping credentials and local db. When a Vite
 * proxy is in use, the client's `host` is the proxy address (localhost:5180),
 * which is the same regardless of upstream — collisions happen when
 * switching between prod/local via the same proxy. Prefer `VITE_PROXY_TARGET`
 * when set so each upstream gets its own keychain slot and db file.
 */
export function getServerIdentity(): string {
    const proxyTarget = getEffectiveProxyTarget();
    if (proxyTarget.length > 0) return proxyTarget;
    return getServerUrl();
}

/** Server options derived from the current URL — use everywhere. */
export function getServerOptions(): ServerOptions {
    const host = getServerUrl();
    const upstream = getServerIdentity();
    const isLocalUpstream = isLocalDevHost(upstream);
    const isLocalClientHost = isLocalDevHost(host);
    return {
        ...(isLocalUpstream && import.meta.env.DEV
            ? { devApiKey: "local-dev" }
            : {}),
        host,
        unsafeHttp: host.startsWith("http://") || isLocalClientHost,
    };
}

export function getServerUrl(): string {
    return normalizeHost(
        localStorage.getItem(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL,
    );
}

export function isLocalDevServer(): boolean {
    return import.meta.env.DEV && isLocalDevHost(getServerIdentity());
}

export function setServerUrl(url: string): void {
    localStorage.setItem(SERVER_URL_KEY, normalizeHost(url));
}

function getEffectiveProxyTarget(): string {
    if (!isViteProxyHost(getServerUrl())) {
        return "";
    }
    if (envProxyTarget.length > 0) {
        return envProxyTarget;
    }
    if (import.meta.env.DEV) {
        return DEV_SERVER_URL;
    }
    return "";
}

function hostOnly(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            return new URL(trimmed).host;
        } catch {
            return (
                trimmed
                    .replace(/^https?:\/\//i, "")
                    .split("/")[0]
                    ?.replace(/\/+$/, "") ?? PROD_SERVER_URL
            );
        }
    }
    return trimmed.split("/")[0] ?? trimmed;
}

function isLocalDevHost(value: string): boolean {
    return DEV_HOST_RE.test(hostOnly(value));
}

function isNonProductionHost(value: string): boolean {
    const host = hostOnly(value);
    return host === DEV_SERVER_URL || DEV_HOST_RE.test(host);
}

function isViteProxyHost(value: string): boolean {
    const host = hostOnly(value);
    return host === VITE_DEV_SERVER_URL || host === "127.0.0.1:5180";
}

function normalizeHost(raw: string): string {
    return hostOnly(raw.replace(/\/+$/, ""));
}

function resolveAppEnvironment(): DesktopAppEnvironment {
    const configured =
        typeof import.meta.env.VITE_APP_ENV === "string"
            ? import.meta.env.VITE_APP_ENV.trim()
            : "";
    if (configured === "development" || configured === "production") {
        return configured;
    }
    if (configured.length > 0) {
        throw new Error(
            `[vex] Unsupported VITE_APP_ENV "${configured}". Expected "development" or "production".`,
        );
    }
    return import.meta.env.DEV ? "development" : "production";
}
