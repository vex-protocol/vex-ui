<script lang="ts">
    import { push } from "svelte-spa-router";

    import {
        channels,
        permissions,
        servers,
        user,
        vexService,
    } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const serverID = $derived(params.serverID ?? "");
    const serverName = $derived($servers[serverID]?.name ?? "Server");
    const channelList = $derived($channels[serverID] ?? []);
    const membershipPermissions = $derived(
        Object.values($permissions).filter(
            (permission) =>
                permission.resourceID === serverID &&
                permission.userID === $user?.userID,
        ),
    );
    const powerLevel = $derived(
        membershipPermissions.length === 0
            ? 0
            : Math.max(
                  ...membershipPermissions.map(
                      (permission) => permission.powerLevel,
                  ),
              ),
    );
    const canCreateChannel = $derived(powerLevel >= 50);
    const canDeleteServer = $derived(powerLevel >= 100);
    const canManageInvites = $derived(membershipPermissions.length > 0);

    let channelName = $state("");
    let creatingChannel = $state(false);
    let createChannelError = $state("");
    let confirmLeave = $state(false);
    let confirmDelete = $state(false);
    let busy = $state(false);
    let actionError = $state("");

    async function createChannel(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (!canCreateChannel || creatingChannel) return;
        const name = channelName.trim();
        if (!name) return;
        creatingChannel = true;
        createChannelError = "";
        try {
            const result = await vexService.createChannel(name, serverID);
            if (!result.ok) {
                createChannelError =
                    result.error ?? "Failed to create channel.";
                return;
            }
            channelName = "";
            const updated = channels.get()[serverID] ?? [];
            const created = updated[updated.length - 1];
            if (created) {
                void push(`/server/${serverID}/${created.channelID}`);
            }
        } finally {
            creatingChannel = false;
        }
    }

    async function leaveServer(): Promise<void> {
        if (busy) return;
        busy = true;
        actionError = "";
        try {
            const result = await vexService.leaveServer(serverID);
            if (!result.ok) {
                actionError = result.error ?? "Failed to leave group.";
                return;
            }
            void push("/home");
        } finally {
            busy = false;
        }
    }

    async function deleteServer(): Promise<void> {
        if (busy || !canDeleteServer) return;
        busy = true;
        actionError = "";
        try {
            const result = await vexService.deleteServer(serverID);
            if (!result.ok) {
                actionError = result.error ?? "Failed to delete server.";
                return;
            }
            void push("/home");
        } finally {
            busy = false;
        }
    }
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => void push(`/server/${serverID}`)}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">{serverName} settings</h1>
                <p class="desktop-page__subtitle">
                    Channels, invites, and membership.
                </p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body">
        {#if actionError}
            <div class="desktop-status desktop-status--error">
                {actionError}
            </div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Channels</h2>
            <div class="desktop-row">
                <div class="desktop-row__info">
                    <span class="desktop-row__label">Existing channels</span>
                    <span class="desktop-row__desc">
                        {channelList.length} channel{channelList.length === 1
                            ? ""
                            : "s"}
                    </span>
                </div>
            </div>
            <form
                class="desktop-row desktop-row--column"
                onsubmit={createChannel}
            >
                <label class="desktop-row__label" for="channel-name">
                    New channel
                </label>
                <div class="desktop-input-row">
                    <input
                        id="channel-name"
                        bind:value={channelName}
                        placeholder="new-channel-name"
                        disabled={!canCreateChannel || creatingChannel}
                    />
                    <button
                        class="desktop-button desktop-button--primary"
                        type="submit"
                        disabled={!canCreateChannel ||
                            !channelName.trim() ||
                            creatingChannel}
                    >
                        {creatingChannel ? "Creating..." : "Create"}
                    </button>
                </div>
                {#if !canCreateChannel}
                    <span class="desktop-muted">
                        Requires moderator power level 50 or higher.
                    </span>
                {/if}
                {#if createChannelError}
                    <span class="desktop-status desktop-status--error">
                        {createChannelError}
                    </span>
                {/if}
            </form>
        </section>

        <section class="desktop-section">
            <h2 class="desktop-section__title">Invites</h2>
            <div class="desktop-row">
                <div class="desktop-row__info">
                    <span class="desktop-row__label">Invite links</span>
                    <span class="desktop-row__desc">
                        Create and copy links for this group.
                    </span>
                </div>
                <button
                    class="desktop-button"
                    onclick={() => void push(`/server/${serverID}/invites`)}
                    disabled={!canManageInvites}
                >
                    Manage invites
                </button>
            </div>
        </section>

        <section class="desktop-section">
            <h2 class="desktop-section__title">Membership</h2>
            <div class="desktop-row">
                <div class="desktop-row__info">
                    <span class="desktop-row__label">Leave group</span>
                    <span class="desktop-row__desc">
                        You will need an invite to rejoin.
                    </span>
                </div>
                {#if confirmLeave}
                    <div class="desktop-actions">
                        <button
                            class="desktop-button desktop-button--danger"
                            onclick={() => void leaveServer()}
                            disabled={busy}
                        >
                            {busy ? "Leaving..." : "Leave"}
                        </button>
                        <button
                            class="desktop-button"
                            onclick={() => {
                                confirmLeave = false;
                            }}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                    </div>
                {:else}
                    <button
                        class="desktop-button desktop-button--danger"
                        onclick={() => {
                            confirmLeave = true;
                        }}
                    >
                        Leave group
                    </button>
                {/if}
            </div>
        </section>

        {#if canDeleteServer}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Danger zone</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Delete server</span>
                        <span class="desktop-row__desc">
                            Deletes {serverName}. This cannot be undone.
                        </span>
                    </div>
                    {#if confirmDelete}
                        <div class="desktop-actions">
                            <button
                                class="desktop-button desktop-button--danger"
                                onclick={() => void deleteServer()}
                                disabled={busy}
                            >
                                {busy ? "Deleting..." : "Delete"}
                            </button>
                            <button
                                class="desktop-button"
                                onclick={() => {
                                    confirmDelete = false;
                                }}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                        </div>
                    {:else}
                        <button
                            class="desktop-button desktop-button--danger"
                            onclick={() => {
                                confirmDelete = true;
                            }}
                        >
                            Delete server
                        </button>
                    {/if}
                </div>
            </section>
        {/if}
    </main>
</div>
