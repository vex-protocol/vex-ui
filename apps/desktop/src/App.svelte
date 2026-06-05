<script lang="ts">
    import Router, { location, push } from "svelte-spa-router";

    import ChannelBar from "./lib/ChannelBar.svelte";
    import { setupDeepLinks } from "./lib/deeplink.js";
    import FamiliarsList from "./lib/FamiliarsList.svelte";
    import MembersPanel from "./lib/MembersPanel.svelte";
    import { setupNotifications } from "./lib/notifications.js";
    import ServerBar from "./lib/ServerBar.svelte";
    import {
        channels,
        familiars,
        keyReplaced,
        servers,
        user,
    } from "./lib/store/index.js";
    import UserMenu from "./lib/UserMenu.svelte";
    import VoiceCallOverlay from "./lib/VoiceCallOverlay.svelte";
    import Home from "./routes/Home.svelte";
    import Launch from "./routes/Launch.svelte";
    import Login from "./routes/Login.svelte";
    import Messaging from "./routes/Messaging.svelte";
    import Register from "./routes/Register.svelte";
    import ServerChannel from "./routes/ServerChannel.svelte";
    import Settings from "./routes/Settings.svelte";

    const routes = {
        "/": Launch,
        "/home": Home,
        "/launch": Launch,
        "/login": Login,
        "/messaging/:userID": Messaging,
        "/register": Register,
        "/server/:serverID/:channelID": ServerChannel,
        "/settings": Settings,
    };

    // Auth routes show no sidebars
    const AUTH_ROUTES = ["/", "/login", "/register", "/launch"];
    const isAuthRoute = $derived(AUTH_ROUTES.some((p) => $location === p));

    // Derive active server/channel from URL
    const activeServerID = $derived(
        $location.startsWith("/server/") ? ($location.split("/")[2] ?? "") : "",
    );
    const activeChannelID = $derived(
        $location.startsWith("/server/") ? ($location.split("/")[3] ?? "") : "",
    );

    // Derive server list and channel list from atoms
    const serverList = $derived(Object.values($servers));
    const activeChannels = $derived(
        activeServerID ? ($channels[activeServerID] ?? []) : [],
    );
    const activeServerName = $derived(
        $servers[activeServerID]?.name ?? "Server",
    );

    // Handle key replaced — server rotated our key; force re-login
    $effect(() => {
        if ($keyReplaced) {
            void push("/login");
        }
    });

    // Auth guard — unauthenticated access to protected routes → /login
    $effect(() => {
        if (!$user && !isAuthRoute) {
            void push("/login");
        }
    });

    // Desktop notifications — subscribe to message atoms, not Client events
    $effect(() => {
        if (!$user) return;
        const unsub = setupNotifications(
            (uid) => $familiars[uid]?.username,
            (cid) => {
                for (const [sid, chs] of Object.entries($channels)) {
                    const ch = chs.find((c) => c.channelID === cid);
                    if (ch)
                        return {
                            channelName: ch.name,
                            serverName: $servers[sid]?.name ?? "Server",
                        };
                }
                return undefined;
            },
        );
        return () => {
            unsub();
        };
    });

    // Register vex:// deep-link handler
    $effect(() => {
        let unsub: (() => void) | undefined;
        void setupDeepLinks().then((fn) => {
            unsub = fn;
        });
        return () => {
            unsub?.();
        };
    });

    // When navigating to a server without a channel, redirect to the first channel
    $effect(() => {
        if (activeServerID && !activeChannelID) {
            const first = activeChannels[0];
            if (first) {
                void push(`/server/${activeServerID}/${first.channelID}`);
            }
        }
    });
</script>

<div class="app">
    <div class="app__body">
        {#if !isAuthRoute}
            <div class="app__sidebar">
                <ServerBar
                    {serverList}
                    {activeServerID}
                    channelMap={$channels}
                />

                {#if activeServerID}
                    <ChannelBar
                        serverID={activeServerID}
                        serverName={activeServerName}
                        channels={activeChannels}
                        {activeChannelID}
                    />
                {/if}
            </div>
        {/if}

        <div class="app__content">
            <Router {routes} />
        </div>

        {#if !isAuthRoute}
            {#if activeServerID}
                <MembersPanel
                    channelID={activeChannelID}
                    serverID={activeServerID}
                />
            {:else}
                <FamiliarsList />
            {/if}
        {/if}
    </div>

    {#if !isAuthRoute}
        <UserMenu
            username={$user?.username ?? ""}
            userID={$user?.userID ?? ""}
        />
        <VoiceCallOverlay />
    {/if}
</div>

<style>
    .app {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
        overflow: hidden;
    }

    .app__body {
        flex: 1;
        display: flex;
        overflow: hidden;
    }

    .app__sidebar {
        display: flex;
        flex-shrink: 0;
    }

    .app__content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
</style>
