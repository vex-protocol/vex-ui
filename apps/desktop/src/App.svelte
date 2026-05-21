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
    import AccountSelector from "./routes/AccountSelector.svelte";
    import AddServer from "./routes/AddServer.svelte";
    import Authenticate from "./routes/Authenticate.svelte";
    import DeviceDetails from "./routes/DeviceDetails.svelte";
    import DeviceManager from "./routes/DeviceManager.svelte";
    import DeviceRequests from "./routes/DeviceRequests.svelte";
    import Home from "./routes/Home.svelte";
    import InviteManager from "./routes/InviteManager.svelte";
    import InvitePreview from "./routes/InvitePreview.svelte";
    import JoinGroup from "./routes/JoinGroup.svelte";
    import Launch from "./routes/Launch.svelte";
    import Login from "./routes/Login.svelte";
    import Messaging from "./routes/Messaging.svelte";
    import Passkeys from "./routes/Passkeys.svelte";
    import Register from "./routes/Register.svelte";
    import ServerChannel from "./routes/ServerChannel.svelte";
    import ServerOverview from "./routes/ServerOverview.svelte";
    import ServerSettings from "./routes/ServerSettings.svelte";
    import SessionDetails from "./routes/SessionDetails.svelte";
    import Settings from "./routes/Settings.svelte";
    import ShareComposer from "./routes/ShareComposer.svelte";

    /* eslint-disable perfectionist/sort-objects -- Route order is semantic for overlapping dynamic paths. */
    const routes = {
        "/": Launch,
        "/accounts": AccountSelector,
        "/add-server": AddServer,
        "/authenticate/:requestID": Authenticate,
        "/authenticate/:requestID/:signKey": Authenticate,
        "/device-requests": DeviceRequests,
        "/device/:deviceID": DeviceDetails,
        "/devices": DeviceManager,
        "/home": Home,
        "/invite/:inviteID": InvitePreview,
        "/join": JoinGroup,
        "/join/:inviteID": JoinGroup,
        "/launch": Launch,
        "/login": Login,
        "/messaging/:userID": Messaging,
        "/passkeys": Passkeys,
        "/register": Register,
        "/server/:serverID/invites": InviteManager,
        "/server/:serverID/settings": ServerSettings,
        "/server/:serverID/:channelID": ServerChannel,
        "/server/:serverID": ServerOverview,
        "/session": SessionDetails,
        "/settings/:section": Settings,
        "/settings": Settings,
        "/share": ShareComposer,
    };
    /* eslint-enable perfectionist/sort-objects */

    // Auth routes show no sidebars
    const AUTH_ROUTES = ["/", "/accounts", "/login", "/register", "/launch"];
    const isAuthRoute = $derived(
        AUTH_ROUTES.some((p) => $location === p) ||
            $location.startsWith("/authenticate/"),
    );

    // Derive active server/channel from URL
    const routeParts = $derived($location.split("/"));
    const activeServerID = $derived(
        $location.startsWith("/server/") ? (routeParts[2] ?? "") : "",
    );
    const serverSubRoute = $derived(routeParts[3] ?? "");
    const isServerUtilityRoute = $derived(
        serverSubRoute === "settings" || serverSubRoute === "invites",
    );
    const isBareServerRoute = $derived(
        Boolean(activeServerID) && !serverSubRoute,
    );
    const activeChannelID = $derived(
        activeServerID && !isServerUtilityRoute ? serverSubRoute : "",
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
        if (isBareServerRoute && !activeChannelID) {
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
            {#if activeServerID && activeChannelID}
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
