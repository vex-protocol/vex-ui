<script lang="ts">
    import type { Channel } from "@vex-chat/libvex";

    import { tick } from "svelte";
    import { push } from "svelte-spa-router";

    import { ChevronDown, Hash, Link, Plus, Settings2 } from "@lucide/svelte";

    import InviteModal from "./InviteModal.svelte";
    import ServerIcon from "./ServerIcon.svelte";
    import ServerSettingsModal from "./ServerSettingsModal.svelte";
    import {
        channels as allChannels,
        channelUnreadCounts,
        permissions,
        servers,
        user,
        vexService,
    } from "./store/index.js";

    let {
        activeChannelID,
        channels = [],
        serverID = "",
    }: {
        activeChannelID?: string;
        channels?: Channel[];
        serverID?: string;
    } = $props();

    const server = $derived($servers[serverID]);
    const myPower = $derived(
        Math.max(
            0,
            ...Object.values($permissions)
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.userID === $user?.userID,
                )
                .map((permission) => permission.powerLevel),
        ),
    );
    const canManageChannels = $derived(myPower >= 50);

    let menuOpen = $state(false);
    let showInvite = $state(false);
    let showSettings = $state(false);
    let addingChannel = $state(false);
    let newChannelName = $state("");
    let addingError = $state("");
    let addChannelInput: HTMLInputElement | null = $state(null);

    function navToChannel(channelID: string): void {
        void push(`/server/${serverID}/${channelID}`);
    }

    async function startAddChannel(): Promise<void> {
        if (!canManageChannels) return;
        addingChannel = true;
        newChannelName = "";
        addingError = "";
        await tick();
        addChannelInput?.focus();
    }

    function cancelAddChannel(): void {
        addingChannel = false;
        newChannelName = "";
        addingError = "";
    }

    async function submitAddChannel(event: Event): Promise<void> {
        event.preventDefault();
        const name = newChannelName.trim();
        if (!name || !serverID) return;
        const result = await vexService.createChannel(name, serverID);
        if (!result.ok) {
            addingError = result.error ?? "Could not create this channel.";
            return;
        }
        const created = ($allChannels[serverID] ?? []).at(-1);
        cancelAddChannel();
        if (created) navToChannel(created.channelID);
    }

    function handleInputKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") cancelAddChannel();
    }
</script>

<nav class="channel-sidebar" aria-label="Channels">
    <header class="channel-sidebar__header">
        <button
            class="channel-sidebar__server"
            type="button"
            onclick={() => (menuOpen = !menuOpen)}
            aria-label="Group options"
            aria-expanded={menuOpen}
        >
            {#if server}
                <ServerIcon {server} size={32} />
            {/if}
            <span class="channel-sidebar__server-name">
                {server?.name ?? "Group"}
            </span>
            <ChevronDown
                class={menuOpen ? "channel-sidebar__chevron--open" : ""}
                size={17}
            />
        </button>

        {#if menuOpen}
            <div class="channel-sidebar__menu" role="menu">
                <button
                    role="menuitem"
                    onclick={() => {
                        showInvite = true;
                        menuOpen = false;
                    }}
                >
                    <Link size={16} />
                    Invite people
                </button>
                <button
                    role="menuitem"
                    onclick={() => {
                        showSettings = true;
                        menuOpen = false;
                    }}
                >
                    <Settings2 size={16} />
                    Group settings
                </button>
            </div>
        {/if}
    </header>

    {#if menuOpen}
        <button
            class="channel-sidebar__backdrop"
            type="button"
            aria-label="Close group menu"
            onclick={() => (menuOpen = false)}
        ></button>
    {/if}

    <div class="channel-sidebar__section">
        <span>Channels</span>
        {#if canManageChannels}
            <button
                class="channel-sidebar__add"
                type="button"
                title="Create channel"
                aria-label="Create channel"
                onclick={() => void startAddChannel()}
            >
                <Plus size={16} />
            </button>
        {/if}
    </div>

    <div class="channel-sidebar__list">
        {#each channels as channel (channel.channelID)}
            {@const unread = $channelUnreadCounts[channel.channelID] ?? 0}
            <button
                class="channel-sidebar__channel"
                class:channel-sidebar__channel--active={activeChannelID ===
                    channel.channelID}
                type="button"
                onclick={() => navToChannel(channel.channelID)}
            >
                <Hash size={17} strokeWidth={2} />
                <span>{channel.name}</span>
                {#if unread > 0}
                    <strong>{unread > 99 ? "99+" : unread}</strong>
                {/if}
            </button>
        {/each}

        {#if addingChannel}
            <form class="channel-sidebar__create" onsubmit={submitAddChannel}>
                <div class="channel-sidebar__input">
                    <Hash size={15} />
                    <input
                        bind:this={addChannelInput}
                        bind:value={newChannelName}
                        type="text"
                        placeholder="channel-name"
                        maxlength={100}
                        autocomplete="off"
                        onkeydown={handleInputKeydown}
                    />
                </div>
                {#if addingError}
                    <p role="alert">{addingError}</p>
                {/if}
                <div class="channel-sidebar__create-actions">
                    <button
                        class="channel-sidebar__save"
                        type="submit"
                        disabled={!newChannelName.trim()}>Create</button
                    >
                    <button type="button" onclick={cancelAddChannel}
                        >Cancel</button
                    >
                </div>
            </form>
        {/if}

        {#if channels.length === 0 && !addingChannel}
            <div class="channel-sidebar__empty">
                <Hash size={20} />
                <span>No channels yet</span>
            </div>
        {/if}
    </div>

    <button
        class="channel-sidebar__manage"
        type="button"
        onclick={() => (showSettings = true)}
    >
        <Settings2 size={16} />
        Manage group
    </button>
</nav>

{#if showInvite}
    <InviteModal
        {serverID}
        serverName={server?.name}
        onclose={() => (showInvite = false)}
    />
{/if}

{#if showSettings}
    <ServerSettingsModal {serverID} onclose={() => (showSettings = false)} />
{/if}

<style>
    .channel-sidebar {
        width: 100%;
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-secondary);
    }

    .channel-sidebar__header {
        position: relative;
        height: var(--topbar-height);
        flex: 0 0 var(--topbar-height);
        border-bottom: 1px solid var(--border);
    }

    .channel-sidebar__server {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        text-align: left;
    }

    .channel-sidebar__server:hover {
        background: var(--bg-hover);
    }

    .channel-sidebar__server-name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        color: var(--text-primary);
        font-family: var(--font-heading);
        font-size: 14px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .channel-sidebar__server :global(svg) {
        flex-shrink: 0;
        color: var(--text-faint);
        transition: transform 140ms ease;
    }

    .channel-sidebar__server :global(.channel-sidebar__chevron--open) {
        transform: rotate(180deg);
    }

    .channel-sidebar__menu {
        position: absolute;
        z-index: 102;
        top: calc(100% + 6px);
        right: 8px;
        left: 8px;
        padding: 6px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-menu);
        animation: vex-pop 180ms var(--ease-out);
        transform-origin: top right;
    }

    .channel-sidebar__menu button {
        width: 100%;
        min-height: 36px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 10px;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: 12.5px;
        font-weight: 600;
        text-align: left;
    }

    .channel-sidebar__menu button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .channel-sidebar__backdrop {
        position: fixed;
        z-index: 101;
        inset: 0;
        width: 100%;
        height: 100%;
        cursor: default;
    }

    .channel-sidebar__section {
        height: 42px;
        flex: 0 0 42px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px 4px 14px;
        color: var(--text-faint);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.11em;
        text-transform: uppercase;
    }

    .channel-sidebar__add {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
    }

    .channel-sidebar__add:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .channel-sidebar__list {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding: 2px 8px 10px;
    }

    .channel-sidebar__channel {
        width: 100%;
        height: 36px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 9px;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        text-align: left;
    }

    .channel-sidebar__channel:hover {
        background: var(--bg-hover);
        color: var(--text-secondary);
    }

    .channel-sidebar__channel--active {
        background: var(--bg-selected);
        color: var(--text-primary);
        box-shadow: inset 2px 0 0 var(--accent);
    }

    .channel-sidebar__channel > span {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .channel-sidebar__channel > strong {
        min-width: 17px;
        height: 17px;
        display: grid;
        place-items: center;
        padding: 0 4px;
        border-radius: 9px;
        background: var(--accent);
        color: var(--on-accent);
        font-family: var(--font-mono);
        font-size: 9.5px;
    }

    .channel-sidebar__create {
        padding: 6px 3px;
    }

    .channel-sidebar__input {
        display: flex;
        align-items: center;
        gap: 5px;
        padding-left: 8px;
        border: 1px solid var(--accent);
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-faint);
    }

    .channel-sidebar__input input {
        border: 0;
        background: transparent;
        box-shadow: none;
        padding: 7px 7px 7px 0;
        font-size: 12px;
    }

    .channel-sidebar__create p {
        margin-top: 5px;
        color: var(--danger);
        font-size: 11px;
        line-height: 1.35;
    }

    .channel-sidebar__create-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 7px;
    }

    .channel-sidebar__create-actions button {
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
    }

    .channel-sidebar__create-actions .channel-sidebar__save {
        color: var(--accent-text);
    }

    .channel-sidebar__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 28px 12px;
        color: var(--text-faint);
        font-size: 12px;
    }

    .channel-sidebar__manage {
        min-height: 42px;
        flex: 0 0 42px;
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 8px 8px;
        padding: 0 9px;
        border-radius: 6px;
        color: var(--text-faint);
        font-size: 12px;
        font-weight: 600;
        text-align: left;
    }

    .channel-sidebar__manage:hover {
        background: var(--bg-hover);
        color: var(--text-secondary);
    }
</style>
