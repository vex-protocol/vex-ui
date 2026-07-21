import type { BootstrapConfig, ServerOptions } from "@vex-chat/store";

import {
    browserDatabaseName,
    createBrowserKeyStore,
    getBrowserDatabaseKey,
} from "./browserVault";
import { IndexedDBStorage } from "./indexedDbStorage";

const SERVER_URL_KEY = "vex-web-server-url";
const DEVELOPMENT_SERVER = "dev.vex.wtf";
const PRODUCTION_SERVER = "api.vex.wtf";

export const browserKeyStore = createBrowserKeyStore(getServerIdentity);

export function buildAvatarURL(userID: string, version = 0): string {
    const url = new URL(
        `/avatar/${encodeURIComponent(userID)}`,
        `${getServerOrigin()}/`,
    );
    if (version > 0) url.searchParams.set("v", String(version));
    return url.toString();
}

export function getServerIdentity(): string {
    if (isDevelopmentProxy()) {
        const configured = import.meta.env.VITE_WEB_SPIRE_PROXY;
        return normalizeHost(
            typeof configured === "string" && configured.trim()
                ? configured
                : DEVELOPMENT_SERVER,
        );
    }
    return getServerHost();
}

export function getServerHost(): string {
    const stored = localStorage.getItem(SERVER_URL_KEY);
    if (stored) return normalizeHost(stored);
    return isDevelopmentProxy() ? window.location.host : PRODUCTION_SERVER;
}

export function getServerOptions(): ServerOptions {
    const host = getServerHost();
    const unsafeHttp =
        window.location.protocol === "http:" || isLocalHost(host);
    return {
        ...(import.meta.env.DEV && isLocalHost(getServerIdentity())
            ? { devApiKey: "local-dev" }
            : {}),
        host,
        unsafeHttp,
    };
}

export function getServerOrigin(): string {
    const host = getServerHost();
    const scheme = isLocalHost(host) ? "http" : "https";
    return /^https?:\/\//iu.test(host) ? host : `${scheme}://${host}`;
}

export function setServerHost(host: string): void {
    localStorage.setItem(SERVER_URL_KEY, normalizeHost(host));
}

export function resetServerHost(): void {
    localStorage.removeItem(SERVER_URL_KEY);
}

export function webBootstrapConfig(): BootstrapConfig {
    return {
        async createStorage(_privateKey, username) {
            const scope = getServerIdentity();
            const key = await getBrowserDatabaseKey(scope, username);
            const storage = new IndexedDBStorage(
                browserDatabaseName(scope, username),
                key,
            );
            await storage.init();
            return storage;
        },
        deviceName: browserDeviceName(),
    };
}

function browserDeviceName(): string {
    const agent = navigator.userAgent;
    const browser = /Edg\//u.test(agent)
        ? "Edge"
        : /Firefox\//u.test(agent)
          ? "Firefox"
          : /Chrome\//u.test(agent)
            ? "Chrome"
            : /Safari\//u.test(agent)
              ? "Safari"
              : "Browser";
    const platform = /iPhone|iPad/u.test(agent)
        ? "iOS"
        : /Android/u.test(agent)
          ? "Android"
          : /Mac/u.test(agent)
            ? "Mac"
            : /Windows/u.test(agent)
              ? "Windows"
              : /Linux/u.test(agent)
                ? "Linux"
                : "Web";
    return `${browser} on ${platform}`;
}

function isDevelopmentProxy(): boolean {
    return import.meta.env.DEV && isLocalHost(window.location.host);
}

function isLocalHost(value: string): boolean {
    const host = normalizeHost(value).split(":")[0] ?? "";
    return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "[::1]" ||
        /^192\.168\./u.test(host) ||
        /^10\./u.test(host)
    );
}

function normalizeHost(value: string): string {
    return value
        .trim()
        .replace(/^https?:\/\//iu, "")
        .replace(/\/+$/u, "")
        .toLowerCase();
}
