<script lang="ts">
    import type { Invite } from "@vex-chat/libvex";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import {
        formatInviteLink,
        servers,
        vexService,
    } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const serverID = $derived(params.serverID ?? "");
    const serverName = $derived($servers[serverID]?.name ?? "server");
    const durations = [
        { label: "1 hour", value: "1h" },
        { label: "1 day", value: "1d" },
        { label: "7 days", value: "7d" },
        { label: "30 days", value: "30d" },
    ];

    let duration = $state("7d");
    let invites: Invite[] = $state([]);
    let loading = $state(true);
    let creating = $state(false);
    let error = $state("");
    let copied = $state("");

    async function loadInvites(): Promise<void> {
        loading = true;
        error = "";
        try {
            invites = await vexService.getInvites(serverID);
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to load invites.";
        } finally {
            loading = false;
        }
    }

    async function createInvite(): Promise<void> {
        creating = true;
        error = "";
        try {
            const invite = await vexService.createInvite(serverID, duration);
            invites = [invite, ...invites];
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to create invite.";
        } finally {
            creating = false;
        }
    }

    async function copy(text: string, label: string): Promise<void> {
        await navigator.clipboard.writeText(text);
        copied = `${label}:${text}`;
        setTimeout(() => {
            copied = "";
        }, 1800);
    }

    onMount(() => {
        void loadInvites();
    });

    function formatDate(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "unknown";
        return date.toLocaleString();
    }
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => void push(`/server/${serverID}/settings`)}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">Invite to {serverName}</h1>
                <p class="desktop-page__subtitle">
                    Create, copy, and share active invite links.
                </p>
            </div>
        </div>
        <button class="desktop-button" onclick={() => void loadInvites()}>
            {loading ? "Refreshing..." : "Refresh"}
        </button>
    </header>

    <main class="desktop-page__body">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Create invite</h2>
            <div class="desktop-row desktop-row--column">
                <div class="duration-row">
                    {#each durations as option (option.value)}
                        <button
                            class="desktop-button {duration === option.value
                                ? 'desktop-button--primary'
                                : ''}"
                            onclick={() => {
                                duration = option.value;
                            }}
                        >
                            {option.label}
                        </button>
                    {/each}
                </div>
                <button
                    class="desktop-button desktop-button--primary invite-create"
                    onclick={() => void createInvite()}
                    disabled={creating}
                >
                    {creating ? "Creating..." : "Create invite link"}
                </button>
            </div>
        </section>

        <section class="desktop-section">
            <h2 class="desktop-section__title">Active invites</h2>
            {#if loading && invites.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">Loading invites...</span>
                </div>
            {:else if invites.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted"
                        >No active invite links yet.</span
                    >
                </div>
            {:else}
                {#each invites as invite (invite.inviteID)}
                    {@const link = formatInviteLink(invite.inviteID)}
                    <div class="desktop-row desktop-row--column invite-row">
                        <span class="desktop-value desktop-mono">{link}</span>
                        <span class="desktop-muted">
                            Expires {formatDate(invite.expiration)}
                        </span>
                        <div class="desktop-actions">
                            <button
                                class="desktop-button"
                                onclick={() => void copy(link, "link")}
                            >
                                {copied === `link:${link}`
                                    ? "Copied"
                                    : "Copy link"}
                            </button>
                            <button
                                class="desktop-button"
                                onclick={() =>
                                    void copy(invite.inviteID, "code")}
                            >
                                {copied === `code:${invite.inviteID}`
                                    ? "Copied"
                                    : "Copy code"}
                            </button>
                        </div>
                    </div>
                {/each}
            {/if}
        </section>
    </main>
</div>

<style>
    .duration-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .invite-create {
        align-self: flex-start;
    }

    .invite-row {
        align-items: stretch;
        gap: 8px;
    }
</style>
