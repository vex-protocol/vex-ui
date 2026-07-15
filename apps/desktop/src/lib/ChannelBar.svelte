<script lang="ts">
    import type { Channel } from "@vex-chat/libvex";

    import { tick } from "svelte";
    import { push } from "svelte-spa-router";

    import InviteModal from "./InviteModal.svelte";
    import {
        channels as channelsStore,
        servers,
        vexService,
    } from "./store/index.js";

    let {
        activeChannelID,
        channels,
        serverID,
        serverName,
    }: {
        activeChannelID?: string;
        channels?: Channel[];
        serverID?: string;
        serverName?: string;
    } = $props();

    function navToChannel(channelID: string): void {
        void push(`/server/${serverID ?? ""}/${channelID}`);
    }

    // ── Server menu ───────────────────────────────────────────────────────────

    let menuOpen = $state(false);
    let confirmDelete = $state(false);
    let deleting = $state(false);
    let deleteError = $state("");
    let showInvite = $state(false);

    async function handleDeleteServer(): Promise<void> {
        if (!serverID) return;
        deleting = true;
        deleteError = "";

        // Compute next destination before deleting
        const allServers = servers.get();
        const remaining = Object.values(allServers).filter(
            (s) => s.serverID !== serverID,
        );
        let dest = "/home";
        if (remaining.length > 0) {
            const next = remaining[0];
            const nextChans = channelsStore.get()[next.serverID] ?? [];
            const firstChan = nextChans[0];
            dest = firstChan
                ? `/server/${next.serverID}/${firstChan.channelID}`
                : "/home";
        }

        const result = await vexService.deleteServer(serverID);
        if (!result.ok) {
            deleteError = result.error ?? "Failed to delete";
            deleting = false;
            return;
        }

        // VexService updates $servers and $channels atoms internally.
        confirmDelete = false;
        menuOpen = false;
        deleting = false;
        void push(dest);
    }

    // ── Add channel ─────────────────────────────────────────────────────────────

    let addingChannel = $state(false);
    let newChannelName = $state("");
    let addingError = $state("");
    let addChannelInput: HTMLInputElement | null = $state(null);

    async function startAddChannel(): Promise<void> {
        addingChannel = true;
        newChannelName = "";
        addingError = "";
        await tick();
        addChannelInput?.focus();
    }

    function cancelAddChannel(): void {
        addingChannel = false;
        newChannelName = "";
    }

    async function submitAddChannel(e: Event): Promise<void> {
        e.preventDefault();
        const name = newChannelName.trim();
        if (!name || !serverID) return;
        addingError = "";
        try {
            const result = await vexService.createChannel(name, serverID);
            if (!result.ok) {
                addingError = result.error ?? "Failed";
                return;
            }
            // VexService updates $channels atom internally.
            // Navigate to the last channel in the updated list (the newly created one).
            const updatedChannels = channelsStore.get()[serverID] ?? [];
            const newChan = updatedChannels[updatedChannels.length - 1];
            addingChannel = false;
            newChannelName = "";
            if (newChan) void push(`/server/${serverID}/${newChan.channelID}`);
        } catch (err: unknown) {
            addingError = err instanceof Error ? err.message : "Failed";
        }
    }

    function onInputKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") cancelAddChannel();
    }
</script>

<nav class="channel-bar" aria-label="Channels">
    <div class="channel-bar__header">
        <button
            class="channel-bar__server-btn"
            onclick={() => (menuOpen = !menuOpen)}
            aria-label="Server options"
            aria-expanded={menuOpen}
        >
            <span class="channel-bar__server-name">{serverName}</span>
            <span class="channel-bar__chevron"
                >{menuOpen ? "\u2715" : "\u25BE"}</span
            >
        </button>

        {#if menuOpen}
            <div class="channel-bar__menu" role="menu">
                {#if !confirmDelete}
                    <button
                        class="channel-bar__menu-item"
                        role="menuitem"
                        onclick={() => {
                            showInvite = true;
                            menuOpen = false;
                        }}
                    >
                        Invite People
                    </button>
                    <button
                        class="channel-bar__menu-item channel-bar__menu-item--danger"
                        role="menuitem"
                        onclick={() => {
                            confirmDelete = true;
                        }}
                    >
                        Delete Server
                    </button>
                {:else}
                    <div class="channel-bar__confirm">
                        <p class="channel-bar__confirm-text">
                            Delete <strong>{serverName}</strong>?
                        </p>
                        {#if deleteError}
                            <p class="channel-bar__delete-error">
                                {deleteError}
                            </p>
                        {/if}
                        <div class="channel-bar__confirm-actions">
                            <button
                                class="channel-bar__confirm-btn channel-bar__confirm-btn--danger"
                                onclick={handleDeleteServer}
                                disabled={deleting}
                            >
                                {deleting ? "Deleting..." : "Delete"}
                            </button>
                            <button
                                class="channel-bar__confirm-btn"
                                onclick={() => {
                                    confirmDelete = false;
                                }}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    {#if menuOpen}
        <div
            class="channel-bar__backdrop"
            role="presentation"
            onclick={() => {
                menuOpen = false;
                confirmDelete = false;
            }}
        ></div>
    {/if}

    <ul class="channel-bar__list">
        <li class="channel-bar__section-label">
            <span>Text Channels</span>
            <button
                class="channel-bar__add-btn"
                title="Add channel"
                aria-label="Add channel"
                onclick={startAddChannel}>+</button
            >
        </li>

        {#each channels as channel (channel.channelID)}
            <li>
                <button
                    class="channel-bar__item {activeChannelID ===
                    channel.channelID
                        ? 'channel-bar__item--active'
                        : ''}"
                    onclick={() => navToChannel(channel.channelID)}
                >
                    <span class="channel-bar__prefix">#</span>
                    <span class="channel-bar__name">{channel.name}</span>
                </button>
            </li>
        {/each}

        {#if addingChannel}
            <li class="channel-bar__add-row">
                <form onsubmit={submitAddChannel}>
                    <input
                        bind:this={addChannelInput}
                        class="channel-bar__add-input"
                        type="text"
                        placeholder="channel-name"
                        bind:value={newChannelName}
                        onkeydown={onInputKeydown}
                        maxlength={32}
                        autocomplete="off"
                    />
                    {#if addingError}
                        <p class="channel-bar__add-error">{addingError}</p>
                    {/if}
                    <div class="channel-bar__add-actions">
                        <button
                            type="submit"
                            class="channel-bar__add-submit"
                            disabled={!newChannelName.trim()}>Add</button
                        >
                        <button
                            type="button"
                            class="channel-bar__add-cancel"
                            onclick={cancelAddChannel}>Cancel</button
                        >
                    </div>
                </form>
            </li>
        {/if}
    </ul>
</nav>

{#if showInvite}
    <InviteModal
        {serverID}
        {serverName}
        onclose={() => {
            showInvite = false;
        }}
    />
{/if}

<style>
    .channel-bar {
        width: var(--channelbar-width);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        overflow: visible;
    }

    .channel-bar__header {
        padding: 0;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        position: relative;
    }

    .channel-bar__server-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        text-align: left;
        transition: background 0.1s;
    }

    .channel-bar__server-btn:hover {
        background: var(--bg-hover);
    }

    .channel-bar__server-name {
        font-weight: 600;
        font-size: 15px;
        color: var(--text-primary);
    }

    .channel-bar__chevron {
        font-size: 12px;
        color: var(--text-muted);
    }

    .channel-bar__menu {
        position: absolute;
        top: 100%;
        left: 8px;
        right: 8px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
        z-index: 101;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .channel-bar__menu-item {
        width: 100%;
        padding: 8px 12px;
        text-align: left;
        font-size: 13px;
        color: var(--text-primary);
        transition: background 0.1s;
    }

    .channel-bar__menu-item:hover {
        background: var(--bg-hover);
    }
    .channel-bar__menu-item--danger {
        color: var(--danger);
    }
    .channel-bar__menu-item--danger:hover {
        background: var(--danger);
        color: #fff;
    }

    .channel-bar__confirm {
        padding: 10px 12px;
    }

    .channel-bar__confirm-text {
        font-size: 13px;
        color: var(--text-primary);
        margin: 0 0 8px;
    }

    .channel-bar__confirm-actions {
        display: flex;
        gap: 6px;
    }

    .channel-bar__confirm-btn {
        flex: 1;
        padding: 5px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        background: var(--bg-hover);
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }

    .channel-bar__confirm-btn--danger {
        background: var(--danger);
        color: #fff;
        border: none;
    }

    .channel-bar__confirm-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .channel-bar__delete-error {
        font-size: 12px;
        color: var(--danger);
        margin: 0 0 6px;
    }

    .channel-bar__backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
    }

    .channel-bar__section-label {
        list-style: none;
        padding: 16px 8px 4px 8px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .channel-bar__add-btn {
        font-size: 16px;
        color: var(--text-muted);
        line-height: 1;
        padding: 0 2px;
        border-radius: 3px;
    }

    .channel-bar__add-btn:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .channel-bar__list {
        list-style: none;
        padding: 4px 8px;
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
        flex: 1;
    }

    .channel-bar__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 14px;
        text-align: left;
        transition:
            background 0.1s,
            color 0.1s;
    }

    .channel-bar__item:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .channel-bar__item--active {
        background: var(--bg-surface);
        color: var(--text-primary);
    }

    .channel-bar__prefix {
        color: var(--text-muted);
        flex-shrink: 0;
    }
    .channel-bar__name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Add channel inline form */
    .channel-bar__add-row {
        list-style: none;
        padding: 4px 2px;
    }

    .channel-bar__add-input {
        width: 100%;
        padding: 5px 8px;
        background: var(--bg-surface);
        border: 1px solid var(--accent);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 13px;
        box-sizing: border-box;
    }

    .channel-bar__add-input:focus {
        outline: none;
    }

    .channel-bar__add-error {
        font-size: 11px;
        color: var(--danger);
        margin: 2px 0 0;
    }

    .channel-bar__add-actions {
        display: flex;
        gap: 4px;
        margin-top: 4px;
    }

    .channel-bar__add-submit,
    .channel-bar__add-cancel {
        flex: 1;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }

    .channel-bar__add-submit {
        background: var(--accent);
        color: #fff;
        border: none;
    }

    .channel-bar__add-submit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .channel-bar__add-cancel {
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border);
    }

    .channel-bar__add-cancel:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }
</style>
