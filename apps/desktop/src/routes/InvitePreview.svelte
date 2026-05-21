<script lang="ts">
    import type { InvitePreview as InvitePreviewData } from "../lib/store/index.js";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import { vexService } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const inviteID = $derived(params.inviteID ?? "");
    let preview = $state<InvitePreviewData | null>(null);
    let loading = $state(true);
    let joining = $state(false);
    let error = $state("");

    async function loadPreview(): Promise<void> {
        loading = true;
        error = "";
        try {
            const loaded = await vexService.previewInvite(inviteID);
            preview = loaded;
            if (!loaded) {
                error = "This invite could not be found or has expired.";
            }
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Unable to load invite preview.";
        } finally {
            loading = false;
        }
    }

    async function joinInvite(): Promise<void> {
        if (joining || !preview) return;
        joining = true;
        error = "";
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok) {
                error = result.error ?? "Unable to join this group.";
                return;
            }
            if (result.serverID && result.channelID) {
                void push(`/server/${result.serverID}/${result.channelID}`);
                return;
            }
            if (result.serverID) {
                void push(`/server/${result.serverID}`);
                return;
            }
            void push("/home");
        } finally {
            joining = false;
        }
    }

    const serverName = $derived(preview?.server?.name ?? "Server invite");
    const serverID = $derived(
        preview?.server?.serverID ?? preview?.invite.serverID,
    );
    const channelSummary = $derived(
        preview ? formatChannelSummary(preview.channels) : "",
    );

    onMount(() => {
        void loadPreview();
    });

    function formatChannelSummary(
        channels: InvitePreviewData["channels"],
    ): string {
        if (channels.length === 0) return "No channels listed";
        const names = channels
            .slice(0, 4)
            .map((channel) => `#${channel.name}`)
            .join(", ");
        const extra =
            channels.length > 4 ? ` +${channels.length - 4} more` : "";
        return `${names}${extra}`;
    }

    function formatDate(value: string | undefined): string {
        if (!value) return "Unavailable";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Unavailable";
        return date.toLocaleString();
    }
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
                <h1 class="desktop-page__title">Invite Preview</h1>
                <p class="desktop-page__subtitle">
                    Review this group before joining.
                </p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body invite-preview">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">{serverName}</h2>
            {#if loading}
                <div class="desktop-row">
                    <span class="desktop-muted">Loading invite metadata...</span
                    >
                </div>
            {:else}
                <div class="desktop-row">
                    <span class="desktop-row__label">Group</span>
                    <span class="desktop-value">{serverName}</span>
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Channels</span>
                    <span class="desktop-value">{channelSummary}</span>
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Expires</span>
                    <span class="desktop-value">
                        {formatDate(preview?.invite.expiration)}
                    </span>
                </div>
                <div class="desktop-row desktop-row--column">
                    <span class="desktop-row__label">Invite code</span>
                    <span class="desktop-value desktop-mono">{inviteID}</span>
                </div>
                <div class="desktop-row desktop-row--column">
                    <span class="desktop-row__label">Server ID</span>
                    <span class="desktop-value desktop-mono">
                        {serverID ?? "Unavailable"}
                    </span>
                </div>
            {/if}
        </section>

        <div class="desktop-actions">
            <button class="desktop-button" onclick={() => void push("/home")}>
                Reject
            </button>
            <button
                class="desktop-button desktop-button--primary"
                onclick={() => void joinInvite()}
                disabled={loading || joining || !preview}
            >
                {joining ? "Joining..." : "Join group"}
            </button>
        </div>
    </main>
</div>

<style>
    .invite-preview {
        max-width: 560px;
    }
</style>
