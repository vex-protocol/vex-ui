import type { FunctionComponent } from "preact";

import {
    $authStatus,
    $channelUnreadCounts,
    $channels,
    $dmUnreadCounts,
    $familiars,
    $hydrationStatus,
    $messages,
    $servers,
    $totalDmUnread,
    $user,
    vexService,
} from "@vex-chat/store";

import {
    Hash,
    Inbox,
    MessageCircle,
    Plus,
    RefreshCw,
    Settings,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { Avatar } from "./components/Avatar";
import { NewDmDialog } from "./components/NewDmDialog";
import { PasskeyUpgradePrompt } from "./components/PasskeyUpgradePrompt";
import { ServerIcon } from "./components/ServerIcon";
import { VexMark } from "./components/VexMark";
import {
    browserKeyStore,
    getServerOptions,
    webBootstrapConfig,
} from "./lib/config";
import { productFeatures } from "./lib/features";
import { authenticatePasskey, registerPasskey } from "./lib/passkey";
import { consumePostAuthPath, rememberPostAuthPath } from "./lib/postAuthRoute";
import {
    channelPath,
    dmPath,
    navigate,
    serverSettingsPath,
    useWebRoute,
    type WebRoute,
} from "./lib/router";
import { useWebTheme } from "./lib/theme";
import { useIncomingNotifications } from "./lib/useIncomingNotifications";
import { useStoreValue } from "./lib/useStoreValue";
import { AuthView } from "./views/AuthView";
import { ConversationView } from "./views/ConversationView";
import { GroupSetupView } from "./views/GroupSetupView";
import { InviteView } from "./views/InviteView";
import { ServerManagementView } from "./views/ServerManagementView";
import { SettingsView } from "./views/SettingsView";

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
        if (user && explicitAuthRoute) {
            navigate(consumePostAuthPath() ?? "/app/home", true);
        }
    }, [explicitAuthRoute, user]);

    useEffect(() => {
        if (!user && !explicitAuthRoute && route.kind !== "home") {
            rememberPostAuthPath(window.location.pathname);
            return;
        }
        if (user && !explicitAuthRoute) consumePostAuthPath();
    }, [explicitAuthRoute, route.kind, user]);

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
    useIncomingNotifications();
    const user = useStoreValue($user);
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const familiars = useStoreValue($familiars);
    const hydration = useStoreValue($hydrationStatus);
    const directMessages = useStoreValue($messages);
    const dmUnread = useStoreValue($dmUnreadCounts);
    const channelUnread = useStoreValue($channelUnreadCounts);
    const totalDmUnread = useStoreValue($totalDmUnread);
    const [newDmOpen, setNewDmOpen] = useState(false);

    if (!user) return null;

    const serverList = Object.values(servers).sort((a, b) =>
        a.name.localeCompare(b.name),
    );
    const familiarList = Object.values(familiars).sort((a, b) => {
        const aTime = lastMessageTime(directMessages[a.userID]);
        const bTime = lastMessageTime(directMessages[b.userID]);
        return bTime - aTime || a.username.localeCompare(b.username);
    });
    const activeServerID =
        route.kind === "server" ||
        route.kind === "channel" ||
        route.kind === "serverSettings"
            ? route.serverID
            : null;
    const activeServer = activeServerID ? servers[activeServerID] : null;
    const activeChannels = activeServerID
        ? (channels[activeServerID] ?? [])
        : [];
    const isDetailRoute = [
        "channel",
        "dm",
        "invite",
        "servers",
        "serverSettings",
        "settings",
    ].includes(route.kind);
    const isStandaloneRoute = [
        "invite",
        "servers",
        "serverSettings",
        "settings",
    ].includes(route.kind);

    return (
        <>
            <main
                className={[
                    "web-shell",
                    isDetailRoute ? "web-shell--detail" : "",
                    isStandaloneRoute ? "web-shell--standalone" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <aside
                    className="web-rail"
                    aria-label="Conversation navigation"
                >
                    <button
                        className={
                            route.kind === "home"
                                ? "web-rail__brand is-active"
                                : "web-rail__brand"
                        }
                        type="button"
                        title="Home"
                        onClick={() => navigate("/app/home")}
                    >
                        <VexMark size={31} />
                    </button>
                    <button
                        className={
                            route.kind === "dm" || route.kind === "dms"
                                ? "rail-item is-active"
                                : "rail-item"
                        }
                        type="button"
                        title="Direct messages"
                        onClick={() => navigate("/app/dms")}
                    >
                        <Inbox size={20} />
                        <UnreadBadge count={totalDmUnread} compact />
                    </button>
                    <span className="web-rail__divider" />
                    {serverList.map((server) => {
                        const unread = (channels[server.serverID] ?? []).reduce(
                            (total, channel) =>
                                total + (channelUnread[channel.channelID] ?? 0),
                            0,
                        );
                        return (
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
                                    const first =
                                        channels[server.serverID]?.[0];
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
                                <ServerIcon server={server} size={44} />
                                <UnreadBadge count={unread} compact />
                            </button>
                        );
                    })}
                    <button
                        className={
                            route.kind === "servers"
                                ? "rail-item rail-add is-active"
                                : "rail-item rail-add"
                        }
                        type="button"
                        title="Create or join a group"
                        onClick={() => navigate("/app/servers")}
                    >
                        <Plus size={20} />
                    </button>
                </aside>

                <aside className="web-sidebar">
                    <header className="web-sidebar__header">
                        <strong>
                            {activeServer?.name ?? "Direct messages"}
                        </strong>
                        {!activeServer ? (
                            <button
                                aria-label="New direct message"
                                title="New direct message"
                                type="button"
                                onClick={() => setNewDmOpen(true)}
                            >
                                <Plus size={17} />
                            </button>
                        ) : null}
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
                                    <span className="web-nav-row__copy">
                                        <strong>{channel.name}</strong>
                                    </span>
                                    <UnreadBadge
                                        count={
                                            channelUnread[channel.channelID] ??
                                            0
                                        }
                                    />
                                </button>
                            ))
                        ) : familiarList.length ? (
                            familiarList.map((familiar) => {
                                const latest =
                                    directMessages[familiar.userID]?.at(-1);
                                return (
                                    <button
                                        className={
                                            route.kind === "dm" &&
                                            route.userID === familiar.userID
                                                ? "web-nav-row web-nav-row--dm is-active"
                                                : "web-nav-row web-nav-row--dm"
                                        }
                                        type="button"
                                        key={familiar.userID}
                                        onClick={() =>
                                            navigate(dmPath(familiar.userID))
                                        }
                                    >
                                        <Avatar
                                            name={familiar.username}
                                            size={32}
                                            userID={familiar.userID}
                                        />
                                        <span className="web-nav-row__copy">
                                            <strong>{familiar.username}</strong>
                                            {latest ? (
                                                <small>
                                                    {messagePreview(
                                                        latest.message,
                                                    )}
                                                </small>
                                            ) : null}
                                        </span>
                                        <UnreadBadge
                                            count={
                                                dmUnread[familiar.userID] ?? 0
                                            }
                                        />
                                    </button>
                                );
                            })
                        ) : (
                            <div className="web-sidebar__empty">
                                <MessageCircle size={19} />
                                <span>No conversations yet</span>
                                <button
                                    type="button"
                                    onClick={() => setNewDmOpen(true)}
                                >
                                    New message
                                </button>
                            </div>
                        )}
                    </nav>
                    <footer className="web-account-bar">
                        <Avatar
                            name={user.username}
                            size={30}
                            userID={user.userID}
                        />
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
                    <div className="web-content__body">
                        {!hydration.ready &&
                        route.kind !== "channel" &&
                        route.kind !== "dm" ? (
                            <AppLoading label="Loading conversations" compact />
                        ) : (
                            <RouteContent
                                directMessages={directMessages}
                                familiars={familiars}
                                route={route}
                                servers={servers}
                                username={user.username}
                                onNewMessage={() => setNewDmOpen(true)}
                            />
                        )}
                    </div>
                </section>
            </main>
            <NewDmDialog open={newDmOpen} onClose={() => setNewDmOpen(false)} />
            <PasskeyUpgradePrompt />
            {productFeatures.voiceCalling ? <LazyVoiceCallOverlay /> : null}
        </>
    );
}

function LazyVoiceCallOverlay() {
    const [Overlay, setOverlay] = useState<FunctionComponent | null>(null);
    useEffect(() => {
        let active = true;
        void import("./components/VoiceCallOverlay").then((loaded) => {
            if (active) setOverlay(() => loaded.VoiceCallOverlay);
        });
        return () => {
            active = false;
        };
    }, []);
    return Overlay ? <Overlay /> : null;
}

function RouteContent({
    directMessages,
    familiars,
    onNewMessage,
    route,
    servers,
    username,
}: {
    directMessages: ReturnType<typeof $messages.get>;
    familiars: ReturnType<typeof $familiars.get>;
    onNewMessage: () => void;
    route: WebRoute;
    servers: ReturnType<typeof $servers.get>;
    username: string;
}) {
    if (route.kind === "channel" || route.kind === "dm") {
        return <ConversationView route={route} />;
    }
    if (route.kind === "servers") {
        return <GroupSetupView />;
    }
    if (route.kind === "invite") {
        return <InviteView inviteID={route.inviteID} />;
    }
    if (route.kind === "settings") {
        return <SettingsView section={route.section} />;
    }
    if (route.kind === "serverSettings") {
        return <ServerManagementView serverID={route.serverID} />;
    }
    if (route.kind === "server") {
        const server = servers[route.serverID];
        return (
            <section className="web-placeholder">
                {server ? <ServerIcon server={server} size={54} /> : null}
                <h1>{server?.name ?? "Group"}</h1>
                <p>Select a channel or open group settings.</p>
                <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => navigate(serverSettingsPath(route.serverID))}
                >
                    <Settings size={16} /> Group settings
                </button>
            </section>
        );
    }
    return (
        <HomeOverview
            directMessages={directMessages}
            familiars={familiars}
            servers={servers}
            username={username}
            onNewMessage={onNewMessage}
        />
    );
}

function HomeOverview({
    directMessages,
    familiars,
    onNewMessage,
    servers,
    username,
}: {
    directMessages: ReturnType<typeof $messages.get>;
    familiars: ReturnType<typeof $familiars.get>;
    onNewMessage: () => void;
    servers: ReturnType<typeof $servers.get>;
    username: string;
}) {
    const recent = Object.values(familiars)
        .map((familiar) => ({
            familiar,
            latest: directMessages[familiar.userID]?.at(-1),
        }))
        .filter((entry) => entry.latest)
        .sort(
            (a, b) =>
                new Date(b.latest?.timestamp ?? 0).getTime() -
                new Date(a.latest?.timestamp ?? 0).getTime(),
        )
        .slice(0, 6);
    return (
        <section className="home-overview">
            <header className="home-overview__header">
                <div>
                    <span>Home</span>
                    <h1>Welcome back, {username}</h1>
                </div>
                <button
                    className="button button--primary"
                    type="button"
                    onClick={onNewMessage}
                >
                    <Plus size={16} /> New message
                </button>
            </header>
            <div className="home-overview__section">
                <h2>Recent conversations</h2>
                <div className="home-recent-list">
                    {recent.length ? (
                        recent.map(({ familiar, latest }) => (
                            <button
                                key={familiar.userID}
                                type="button"
                                onClick={() =>
                                    navigate(dmPath(familiar.userID))
                                }
                            >
                                <Avatar
                                    name={familiar.username}
                                    size={36}
                                    userID={familiar.userID}
                                />
                                <span>
                                    <strong>{familiar.username}</strong>
                                    <small>
                                        {messagePreview(latest?.message ?? "")}
                                    </small>
                                </span>
                            </button>
                        ))
                    ) : (
                        <p>No recent conversations.</p>
                    )}
                </div>
            </div>
            <div className="home-overview__section">
                <h2>Groups</h2>
                <div className="home-server-list">
                    {Object.values(servers).map((server) => (
                        <button
                            key={server.serverID}
                            type="button"
                            onClick={() =>
                                navigate(`/app/server/${server.serverID}`)
                            }
                        >
                            <ServerIcon server={server} size={38} />
                            <strong>{server.name}</strong>
                        </button>
                    ))}
                    <button
                        className="home-server-list__add"
                        type="button"
                        onClick={() => navigate("/app/servers")}
                    >
                        <span>
                            <Plus size={17} />
                        </span>
                        <strong>Create or join</strong>
                    </button>
                    {Object.keys(servers).length === 0 ? (
                        <p>Your groups will appear here.</p>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function UnreadBadge({
    compact = false,
    count,
}: {
    compact?: boolean;
    count: number;
}) {
    if (count <= 0) return null;
    return (
        <span
            aria-label={`${count} unread`}
            className={compact ? "unread-badge is-compact" : "unread-badge"}
        >
            {count > 99 ? "99+" : count}
        </span>
    );
}

function lastMessageTime(messages: ReturnType<typeof $messages.get>[string]) {
    const timestamp = messages?.at(-1)?.timestamp;
    return timestamp ? new Date(timestamp).getTime() : 0;
}

function messagePreview(value: string): string {
    const normalized = value.replace(/\s+/gu, " ").trim();
    if (!normalized) return "Attachment";
    return normalized.length > 58
        ? `${normalized.slice(0, 55)}...`
        : normalized;
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
