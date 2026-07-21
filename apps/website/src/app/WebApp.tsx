import {
    $authStatus,
    $channels,
    $familiars,
    $hydrationStatus,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";

import {
    ChevronRight,
    CircleUserRound,
    Hash,
    Inbox,
    LogOut,
    MessageCircle,
    RefreshCw,
    Settings,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { VexMark } from "./components/VexMark";
import {
    browserKeyStore,
    getServerOptions,
    webBootstrapConfig,
} from "./lib/config";
import { productFeatures } from "./lib/features";
import { authenticatePasskey, registerPasskey } from "./lib/passkey";
import {
    channelPath,
    dmPath,
    navigate,
    useWebRoute,
    type WebRoute,
} from "./lib/router";
import { useWebTheme } from "./lib/theme";
import { useStoreValue } from "./lib/useStoreValue";
import { AuthView } from "./views/AuthView";

import "./app.css";

if (typeof (globalThis as { process?: unknown }).process === "undefined") {
    (
        globalThis as unknown as {
            process: { env: { NODE_ENV: string } };
        }
    ).process = {
        env: {
            NODE_ENV: import.meta.env.DEV ? "development" : "production",
        },
    };
}

vexService.configureProductFeatures(productFeatures);
vexService.setPasskeyCeremonyDriver({
    authenticate: authenticatePasskey,
    register: registerPasskey,
});

type BootState =
    | { kind: "checking" }
    | { kind: "error"; message: string }
    | { kind: "ready" };

export function WebApp() {
    useWebTheme();
    const route = useWebRoute();
    const user = useStoreValue($user);
    const authStatus = useStoreValue($authStatus);
    const [boot, setBoot] = useState<BootState>({ kind: "checking" });
    const bootStarted = useRef(false);
    const explicitAuthRoute = isAuthRoute(route);

    useEffect(() => {
        document.body.classList.add("vex-web-app");
        return () => document.body.classList.remove("vex-web-app");
    }, []);

    useEffect(() => {
        if (bootStarted.current || explicitAuthRoute) {
            if (explicitAuthRoute) setBoot({ kind: "ready" });
            return;
        }
        bootStarted.current = true;
        void runAutoLogin().then(setBoot);
    }, [explicitAuthRoute]);

    useEffect(() => {
        if (user && explicitAuthRoute) navigate("/app/home", true);
    }, [explicitAuthRoute, user]);

    useEffect(() => {
        const resume = () => {
            if (
                document.visibilityState === "visible" &&
                !$user.get() &&
                !vexService.isAuthFlowInFlight()
            ) {
                void runAutoLogin().then(setBoot);
            }
        };
        document.addEventListener("visibilitychange", resume);
        window.addEventListener("online", resume);
        return () => {
            document.removeEventListener("visibilitychange", resume);
            window.removeEventListener("online", resume);
        };
    }, []);

    if (user) return <ConnectedShell route={route} />;
    if (explicitAuthRoute) return <AuthView route={route} />;
    if (boot.kind === "checking" || authStatus === "checking") {
        return <AppLoading label="Connecting securely" />;
    }
    if (boot.kind === "error") {
        return (
            <main className="web-state-page">
                <VexMark label size={38} />
                <h1>Can't connect</h1>
                <p>{boot.message}</p>
                <div className="web-state-actions">
                    <button
                        className="button button--primary"
                        type="button"
                        onClick={() => {
                            setBoot({ kind: "checking" });
                            void runAutoLogin().then(setBoot);
                        }}
                    >
                        <RefreshCw size={16} /> Retry
                    </button>
                    <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => navigate("/app/login")}
                    >
                        Sign in
                    </button>
                </div>
            </main>
        );
    }
    return <AuthView route={{ kind: "login" }} />;
}

async function runAutoLogin(): Promise<BootState> {
    try {
        const result = await Promise.race([
            vexService.autoLogin(
                browserKeyStore,
                webBootstrapConfig(),
                getServerOptions(),
            ),
            new Promise<{ error: string; ok: false }>((resolve) =>
                window.setTimeout(
                    () =>
                        resolve({
                            error: "The connection timed out. Check your network and try again.",
                            ok: false,
                        }),
                    15_000,
                ),
            ),
        ]);
        if (result.ok || !result.error) return { kind: "ready" };
        if ("requireReauth" in result && result.requireReauth) {
            return { kind: "ready" };
        }
        return { kind: "error", message: result.error };
    } catch (error: unknown) {
        return {
            kind: "error",
            message:
                error instanceof Error
                    ? error.message
                    : "Vex could not connect to the server.",
        };
    }
}

function ConnectedShell({ route }: { route: WebRoute }) {
    const user = useStoreValue($user);
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const familiars = useStoreValue($familiars);
    const hydration = useStoreValue($hydrationStatus);

    if (!user) return null;

    const serverList = Object.values(servers).sort((a, b) =>
        a.name.localeCompare(b.name),
    );
    const familiarList = Object.values(familiars).sort((a, b) =>
        a.username.localeCompare(b.username),
    );
    const activeServerID =
        route.kind === "server" || route.kind === "channel"
            ? route.serverID
            : null;
    const activeServer = activeServerID ? servers[activeServerID] : null;
    const activeChannels = activeServerID
        ? (channels[activeServerID] ?? [])
        : [];

    return (
        <main className="web-shell">
            <aside className="web-rail" aria-label="Conversation navigation">
                <button
                    className="web-rail__brand"
                    type="button"
                    title="Home"
                    onClick={() => navigate("/app/home")}
                >
                    <VexMark size={31} />
                </button>
                <button
                    className={
                        route.kind === "dms"
                            ? "rail-item is-active"
                            : "rail-item"
                    }
                    type="button"
                    title="Direct messages"
                    onClick={() => navigate("/app/dms")}
                >
                    <Inbox size={20} />
                </button>
                <span className="web-rail__divider" />
                {serverList.map((server) => (
                    <button
                        className={
                            activeServerID === server.serverID
                                ? "rail-server is-active"
                                : "rail-server"
                        }
                        type="button"
                        title={server.name}
                        key={server.serverID}
                        onClick={() => {
                            const first = channels[server.serverID]?.[0];
                            navigate(
                                first
                                    ? channelPath(
                                          server.serverID,
                                          first.channelID,
                                      )
                                    : `/app/server/${server.serverID}`,
                            );
                        }}
                    >
                        {server.name.slice(0, 2).toUpperCase()}
                    </button>
                ))}
            </aside>

            <aside className="web-sidebar">
                <header className="web-sidebar__header">
                    <strong>{activeServer?.name ?? "Direct messages"}</strong>
                </header>
                <nav className="web-nav-list">
                    {activeServer ? (
                        activeChannels.map((channel) => (
                            <button
                                className={
                                    route.kind === "channel" &&
                                    route.channelID === channel.channelID
                                        ? "web-nav-row is-active"
                                        : "web-nav-row"
                                }
                                type="button"
                                key={channel.channelID}
                                onClick={() =>
                                    navigate(
                                        channelPath(
                                            activeServer.serverID,
                                            channel.channelID,
                                        ),
                                    )
                                }
                            >
                                <Hash size={17} />
                                <span>{channel.name}</span>
                            </button>
                        ))
                    ) : familiarList.length ? (
                        familiarList.map((familiar) => (
                            <button
                                className={
                                    route.kind === "dm" &&
                                    route.userID === familiar.userID
                                        ? "web-nav-row is-active"
                                        : "web-nav-row"
                                }
                                type="button"
                                key={familiar.userID}
                                onClick={() =>
                                    navigate(dmPath(familiar.userID))
                                }
                            >
                                <CircleUserRound size={17} />
                                <span>{familiar.username}</span>
                            </button>
                        ))
                    ) : (
                        <p className="web-sidebar__empty">
                            No conversations yet
                        </p>
                    )}
                </nav>
                <footer className="web-account-bar">
                    <CircleUserRound size={20} />
                    <span>{user.username}</span>
                    <button
                        type="button"
                        title="Settings"
                        onClick={() => navigate("/app/settings/account")}
                    >
                        <Settings size={17} />
                    </button>
                </footer>
            </aside>

            <section className="web-content">
                <header className="web-content__header">
                    {routeTitle(route, servers, channels, familiars)}
                </header>
                <div className="web-content__body">
                    {!hydration.ready ? (
                        <AppLoading label="Loading conversations" compact />
                    ) : (
                        <RouteSummary route={route} username={user.username} />
                    )}
                </div>
            </section>
        </main>
    );
}

function RouteSummary({
    route,
    username,
}: {
    route: WebRoute;
    username: string;
}) {
    if (route.kind === "settings") {
        return (
            <section className="web-placeholder">
                <Settings size={24} />
                <h1>Account</h1>
                <p>{username}</p>
                <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void vexService.logout()}
                >
                    <LogOut size={16} /> Sign out
                </button>
            </section>
        );
    }
    return (
        <section className="web-placeholder">
            <MessageCircle size={26} />
            <h1>
                {route.kind === "home" ? `Welcome, ${username}` : "Messages"}
            </h1>
            <p>Select a conversation to start messaging.</p>
        </section>
    );
}

function routeTitle(
    route: WebRoute,
    servers: ReturnType<typeof $servers.get>,
    channels: ReturnType<typeof $channels.get>,
    familiars: ReturnType<typeof $familiars.get>,
) {
    if (route.kind === "channel") {
        const channel = channels[route.serverID]?.find(
            (candidate) => candidate.channelID === route.channelID,
        );
        return (
            <>
                <Hash size={18} /> <strong>{channel?.name ?? "Channel"}</strong>
            </>
        );
    }
    if (route.kind === "dm") {
        return (
            <>
                <CircleUserRound size={18} />
                <strong>
                    {familiars[route.userID]?.username ?? "Direct message"}
                </strong>
            </>
        );
    }
    if (route.kind === "server") {
        return (
            <>
                <ChevronRight size={18} />
                <strong>{servers[route.serverID]?.name ?? "Group"}</strong>
            </>
        );
    }
    return <strong>{route.kind === "settings" ? "Settings" : "Vex"}</strong>;
}

function AppLoading({
    compact = false,
    label,
}: {
    compact?: boolean;
    label: string;
}) {
    return (
        <main
            className={
                compact ? "app-loading app-loading--compact" : "app-loading"
            }
        >
            <span className="app-loading__indicator" />
            <span>{label}</span>
        </main>
    );
}

function isAuthRoute(
    route: WebRoute,
): route is Extract<WebRoute, { kind: "login" | "recover" | "register" }> {
    return ["login", "recover", "register"].includes(route.kind);
}
