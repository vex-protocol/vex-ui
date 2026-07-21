import { useEffect, useState } from "preact/hooks";

const NAVIGATION_EVENT = "vex-web-navigation";

export type WebRoute =
    | { kind: "channel"; channelID: string; serverID: string }
    | { kind: "dm"; userID: string }
    | { kind: "dms" }
    | { kind: "home" }
    | { kind: "invite"; inviteID: string }
    | { kind: "login" }
    | { kind: "recover" }
    | { kind: "register" }
    | { kind: "server"; serverID: string }
    | { kind: "servers" }
    | { kind: "settings"; section: SettingsSection };

export type SettingsSection =
    | "account"
    | "appearance"
    | "connection"
    | "data"
    | "devices"
    | "notifications"
    | "passkeys"
    | "password";

export function channelPath(serverID: string, channelID: string): string {
    return `/app/server/${encodeURIComponent(serverID)}/${encodeURIComponent(channelID)}`;
}

export function dmPath(userID: string): string {
    return `/app/dm/${encodeURIComponent(userID)}`;
}

export function navigate(path: string, replace = false): void {
    const normalized = path.startsWith("/app") ? path : `/app${path}`;
    if (window.location.pathname === normalized) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", normalized);
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function settingsPath(section: SettingsSection): string {
    return `/app/settings/${section}`;
}

export function useWebRoute(): WebRoute {
    const [route, setRoute] = useState<WebRoute>(() => parseRoute());
    useEffect(() => {
        const update = () => setRoute(parseRoute());
        window.addEventListener("popstate", update);
        window.addEventListener(NAVIGATION_EVENT, update);
        return () => {
            window.removeEventListener("popstate", update);
            window.removeEventListener(NAVIGATION_EVENT, update);
        };
    }, []);
    return route;
}

function parseRoute(): WebRoute {
    const segments = window.location.pathname
        .replace(/^\/app\/?/u, "")
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment));
    const [first, second, third] = segments;
    if (first === "login") return { kind: "login" };
    if (first === "register") return { kind: "register" };
    if (first === "recover") return { kind: "recover" };
    if (first === "dms") return { kind: "dms" };
    if (first === "dm" && second) return { kind: "dm", userID: second };
    if (first === "servers") return { kind: "servers" };
    if (first === "server" && second && third) {
        return { channelID: third, kind: "channel", serverID: second };
    }
    if (first === "server" && second) {
        return { kind: "server", serverID: second };
    }
    if (first === "invite" && second) {
        return { inviteID: second, kind: "invite" };
    }
    if (first === "settings") {
        return {
            kind: "settings",
            section: isSettingsSection(second) ? second : "account",
        };
    }
    return { kind: "home" };
}

function isSettingsSection(value: unknown): value is SettingsSection {
    return [
        "account",
        "appearance",
        "connection",
        "data",
        "devices",
        "notifications",
        "passkeys",
        "password",
    ].includes(String(value));
}
