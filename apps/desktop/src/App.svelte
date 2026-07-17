<script lang="ts">
    import { onMount } from "svelte";
    import Router, { location, push } from "svelte-spa-router";
    import { wrap } from "svelte-spa-router/wrap";

    import ChannelBar from "./lib/ChannelBar.svelte";
    import { setupDeepLinks } from "./lib/deeplink.js";
    import FamiliarsList from "./lib/FamiliarsList.svelte";
    import { productFeatures } from "./lib/features.js";
    import MembersPanel from "./lib/MembersPanel.svelte";
    import { setupNotifications } from "./lib/notifications.js";
    import ServerBar from "./lib/ServerBar.svelte";
    import {
        channels,
        familiars,
        groupMessages,
        keyReplaced,
        messages,
        servers,
        user,
        vexService,
    } from "./lib/store/index.js";
    import { memberPanelOpen } from "./lib/stores/layout.js";
    import UserMenu from "./lib/UserMenu.svelte";
    import VoiceCallOverlay from "./lib/VoiceCallOverlay.svelte";
    import Launch from "./routes/Launch.svelte";

    vexService.configureProductFeatures(productFeatures);

    const routes = {
        "/": Launch,
        "/home": wrap({
            asyncComponent: () => import("./routes/Home.svelte"),
        }),
        "/launch": Launch,
        "/login": wrap({
            asyncComponent: () => import("./routes/Login.svelte"),
        }),
        "/messaging/:userID": wrap({
            asyncComponent: () => import("./routes/Messaging.svelte"),
        }),
        "/recover": wrap({
            asyncComponent: () => import("./routes/RecoverPassword.svelte"),
        }),
        "/register": wrap({
            asyncComponent: () => import("./routes/Register.svelte"),
        }),
        "/server/:serverID/:channelID": wrap({
            asyncComponent: () => import("./routes/ServerChannel.svelte"),
        }),
        "/settings": wrap({
            asyncComponent: () => import("./routes/Settings.svelte"),
        }),
        "/settings/appearance": wrap({
            asyncComponent: () => import("./routes/SettingsAppearance.svelte"),
        }),
        "/settings/connection": wrap({
            asyncComponent: () => import("./routes/SettingsConnection.svelte"),
        }),
        "/settings/passkeys": wrap({
            asyncComponent: () => import("./routes/SettingsPasskeys.svelte"),
        }),
        "/settings/password": wrap({
            asyncComponent: () => import("./routes/SettingsPassword.svelte"),
        }),
    };

    const AUTH_ROUTES = ["/", "/login", "/recover", "/register", "/launch"];
    const isAuthRoute = $derived(AUTH_ROUTES.includes($location));
    const activeServerID = $derived(
        $location.startsWith("/server/") ? ($location.split("/")[2] ?? "") : "",
    );
    const activeChannelID = $derived(
        $location.startsWith("/server/") ? ($location.split("/")[3] ?? "") : "",
    );
    const activeDmUserID = $derived(
        $location.startsWith("/messaging/")
            ? ($location.split("/")[2] ?? "")
            : "",
    );
    const activeConversationKey = $derived(activeChannelID || activeDmUserID);
    const activeConversationLatestMessageID = $derived.by(() => {
        const conversation = activeChannelID
            ? ($groupMessages[activeChannelID] ?? [])
            : activeDmUserID
              ? ($messages[activeDmUserID] ?? [])
              : [];
        return conversation.at(-1)?.mailID ?? "";
    });
    let appWindowFocused = $state(false);
    const serverList = $derived(
        Object.values($servers).sort((a, b) => a.name.localeCompare(b.name)),
    );
    const activeChannels = $derived(
        activeServerID ? ($channels[activeServerID] ?? []) : [],
    );

    onMount(() => {
        const updateFocus = (): void => {
            appWindowFocused =
                document.visibilityState === "visible" && document.hasFocus();
        };
        window.addEventListener("blur", updateFocus);
        window.addEventListener("focus", updateFocus);
        document.addEventListener("visibilitychange", updateFocus);
        updateFocus();
        return () => {
            window.removeEventListener("blur", updateFocus);
            window.removeEventListener("focus", updateFocus);
            document.removeEventListener("visibilitychange", updateFocus);
        };
    });

    $effect(() => {
        if ($keyReplaced) void push("/login");
    });

    $effect(() => {
        if (!$user && !isAuthRoute) void push("/login");
    });

    $effect(() => {
        // Rerun when the active thread grows, but only acknowledge messages the
        // user can actually see. Refocusing the window clears anything received
        // while Vex was hidden or in the background.
        void activeConversationLatestMessageID;
        if (!$user || !appWindowFocused || !activeConversationKey) return;
        vexService.markRead(activeConversationKey);
    });

    $effect(() => {
        if (!$user) return;
        const unsubscribe = setupNotifications(
            (userID) => $familiars[userID]?.username,
            (channelID) => {
                for (const [serverID, serverChannels] of Object.entries(
                    $channels,
                )) {
                    const channel = serverChannels.find(
                        (candidate) => candidate.channelID === channelID,
                    );
                    if (channel) {
                        return {
                            channelName: channel.name,
                            serverName: $servers[serverID]?.name ?? "Group",
                        };
                    }
                }
                return undefined;
            },
        );
        return unsubscribe;
    });

    $effect(() => {
        let unsubscribe: (() => void) | undefined;
        void setupDeepLinks().then((cleanup) => {
            unsubscribe = cleanup;
        });
        return () => unsubscribe?.();
    });

    $effect(() => {
        if (!activeServerID) return;
        if (!$servers[activeServerID]) {
            void push("/home");
            return;
        }
        const channelExists = activeChannels.some(
            (channel) => channel.channelID === activeChannelID,
        );
        if (!channelExists) {
            const first = activeChannels[0];
            if (first) {
                void push(`/server/${activeServerID}/${first.channelID}`);
            }
        }
    });
</script>

<div class="app-shell">
    {#if isAuthRoute}
        <main class="app-shell__auth">
            <Router {routes} />
        </main>
    {:else}
        <ServerBar {serverList} {activeServerID} channelMap={$channels} />

        <div class="app-shell__navigation">
            {#if activeServerID}
                <ChannelBar
                    serverID={activeServerID}
                    channels={activeChannels}
                    {activeChannelID}
                />
            {:else}
                <FamiliarsList />
            {/if}
            <UserMenu
                username={$user?.username ?? ""}
                userID={$user?.userID ?? ""}
            />
        </div>

        <main class="app-shell__content">
            <Router {routes} />
        </main>

        {#if activeServerID && $memberPanelOpen}
            <div class="app-shell__members">
                <MembersPanel
                    channelID={activeChannelID}
                    serverID={activeServerID}
                />
            </div>
        {/if}

        {#if productFeatures.voiceCalling}
            <VoiceCallOverlay />
        {/if}
    {/if}
</div>

<style>
    .app-shell {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .app-shell__auth,
    .app-shell__content {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .app-shell__navigation {
        width: var(--channelbar-width);
        min-width: var(--channelbar-width);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-right: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .app-shell__members {
        width: var(--members-width);
        min-width: var(--members-width);
        display: flex;
        overflow: hidden;
    }

    @media (max-width: 1050px) {
        .app-shell__members {
            position: absolute;
            z-index: 80;
            top: 0;
            right: 0;
            bottom: 0;
            box-shadow: -12px 0 32px rgba(0, 0, 0, 0.34);
        }
    }
</style>
