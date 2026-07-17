<script lang="ts">
    import type { Channel, Server } from "@vex-chat/libvex";

    import { push } from "svelte-spa-router";

    import { MessagesSquare, Plus } from "@lucide/svelte";

    import CreateServerModal from "./CreateServerModal.svelte";
    import ServerIcon from "./ServerIcon.svelte";
    import { channelUnreadCounts, totalDmUnread } from "./store/index.js";

    let {
        activeServerID,
        channelMap = {},
        serverList = [],
    }: {
        activeServerID?: string;
        channelMap?: Record<string, Channel[]>;
        serverList?: Server[];
    } = $props();

    let showCreate = $state(false);

    function navigateToServer(serverID: string): void {
        const first = channelMap[serverID]?.[0];
        void push(
            first
                ? `/server/${serverID}/${first.channelID}`
                : `/server/${serverID}/`,
        );
    }

    function unreadForServer(serverID: string): number {
        return (channelMap[serverID] ?? []).reduce(
            (total, channel) =>
                total + ($channelUnreadCounts[channel.channelID] ?? 0),
            0,
        );
    }

    function formatUnread(count: number): string {
        return count > 99 ? "99+" : String(count);
    }
</script>

<nav class="server-rail" aria-label="Groups">
    <button
        class="server-rail__button"
        class:server-rail__button--active={!activeServerID}
        onclick={() => void push("/home")}
        title="Direct messages"
        aria-label="Direct messages"
    >
        <MessagesSquare size={21} strokeWidth={2} />
        {#if $totalDmUnread > 0}
            <span class="server-rail__badge">
                {formatUnread($totalDmUnread)}
            </span>
        {/if}
    </button>

    <div class="server-rail__divider"></div>

    <div class="server-rail__list">
        {#each serverList as server (server.serverID)}
            {@const unread = unreadForServer(server.serverID)}
            <button
                class="server-rail__server"
                class:server-rail__server--active={activeServerID ===
                    server.serverID}
                onclick={() => navigateToServer(server.serverID)}
                title={server.name}
                aria-label={server.name}
            >
                <ServerIcon {server} size={44} />
                {#if unread > 0}
                    <span class="server-rail__badge">
                        {formatUnread(unread)}
                    </span>
                {/if}
            </button>
        {/each}
    </div>

    <button
        class="server-rail__button server-rail__button--add"
        title="Create or join a group"
        aria-label="Create or join a group"
        onclick={() => {
            showCreate = true;
        }}
    >
        <Plus size={22} strokeWidth={2.2} />
    </button>
</nav>

{#if showCreate}
    <CreateServerModal
        onclose={() => {
            showCreate = false;
        }}
    />
{/if}

<style>
    .server-rail {
        width: var(--serverbar-width);
        min-width: var(--serverbar-width);
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 10px 10px 12px;
        overflow: hidden;
        border-right: 1px solid var(--border);
        background: var(--bg-tertiary);
    }

    .server-rail__button,
    .server-rail__server {
        position: relative;
        width: 48px;
        height: 48px;
        flex: 0 0 48px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        color: var(--text-muted);
    }

    .server-rail__button {
        background: var(--bg-surface);
        transition:
            background 140ms ease,
            color 140ms ease;
    }

    .server-rail__button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .server-rail__button--active {
        background: var(--bg-selected);
        color: var(--text-primary);
    }

    .server-rail__button--active::before,
    .server-rail__server--active::before {
        content: "";
        position: absolute;
        left: -10px;
        width: 3px;
        height: 28px;
        border-radius: 0 3px 3px 0;
        background: var(--accent);
    }

    .server-rail__server :global(.server-icon) {
        transition:
            filter 140ms ease,
            transform 140ms ease;
    }

    .server-rail__server:hover :global(.server-icon) {
        filter: brightness(1.1);
        transform: translateY(-1px);
    }

    .server-rail__server--active :global(.server-icon) {
        box-shadow: 0 0 0 2px var(--accent);
    }

    .server-rail__divider {
        width: 32px;
        height: 1px;
        flex: 0 0 1px;
        background: var(--border);
    }

    .server-rail__list {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 2px 0;
    }

    .server-rail__badge {
        position: absolute;
        right: -3px;
        bottom: -2px;
        min-width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 0 4px;
        border: 2px solid var(--bg-tertiary);
        border-radius: 9px;
        background: var(--accent);
        color: var(--on-accent);
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
    }

    .server-rail__button--add {
        flex-shrink: 0;
        color: var(--success);
    }

    .server-rail__button--add:hover {
        background: color-mix(in srgb, var(--success) 16%, transparent);
        color: var(--success);
    }
</style>
