<script lang="ts">
    import { push } from "svelte-spa-router";

    import { channels, servers } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const serverID = $derived(params.serverID ?? "");
    const server = $derived($servers[serverID]);
    const channelList = $derived($channels[serverID] ?? []);
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => void push("/home")}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">{server?.name ?? "Server"}</h1>
                <p class="desktop-page__subtitle">
                    {channelList.length} channel{channelList.length === 1
                        ? ""
                        : "s"}
                </p>
            </div>
        </div>
        <div class="desktop-actions">
            <button
                class="desktop-button"
                onclick={() => void push(`/server/${serverID}/settings`)}
            >
                Settings
            </button>
            <button
                class="desktop-button desktop-button--primary"
                onclick={() => void push(`/server/${serverID}/invites`)}
            >
                Invites
            </button>
        </div>
    </header>

    <main class="desktop-page__body">
        <section class="desktop-section">
            <h2 class="desktop-section__title">Channels</h2>
            {#if channelList.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">No channels yet.</span>
                </div>
            {:else}
                {#each channelList as channel (channel.channelID)}
                    <button
                        class="desktop-row channel-link"
                        onclick={() =>
                            void push(
                                `/server/${serverID}/${channel.channelID}`,
                            )}
                    >
                        <div class="desktop-row__info">
                            <span class="desktop-row__label">
                                #{channel.name}
                            </span>
                            <span class="desktop-row__desc desktop-mono">
                                {channel.channelID}
                            </span>
                        </div>
                        <span class="channel-link__chevron">›</span>
                    </button>
                {/each}
            {/if}
        </section>
    </main>
</div>

<style>
    .channel-link {
        width: 100%;
        color: inherit;
        text-align: left;
        background: transparent;
    }

    .channel-link:hover {
        background: var(--bg-hover);
    }

    .channel-link__chevron {
        color: var(--text-muted);
        font-size: 22px;
    }
</style>
