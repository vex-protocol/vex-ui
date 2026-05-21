<script lang="ts">
    import type { SessionInfo } from "../lib/store/index.js";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import { authStatus, vexService } from "../lib/store/index.js";

    let session = $state<null | SessionInfo>(null);
    let loading = $state(true);
    let error = $state("");

    async function refresh(): Promise<void> {
        loading = true;
        error = "";
        try {
            session = await vexService.getSessionInfo();
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to load session details.";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        void refresh();
    });
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => void push("/settings/account")}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">Session Details</h1>
                <p class="desktop-page__subtitle">
                    Current authentication and device session.
                </p>
            </div>
        </div>
        <button class="desktop-button" onclick={() => void refresh()}>
            {loading ? "Refreshing..." : "Refresh"}
        </button>
    </header>

    <main class="desktop-page__body">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Session</h2>
            <div class="desktop-row">
                <span class="desktop-row__label">Auth status</span>
                <span class="desktop-value"
                    >{session?.authStatus ?? $authStatus}</span
                >
            </div>
            <div class="desktop-row">
                <span class="desktop-row__label">Username</span>
                <span class="desktop-value">{session?.username ?? "-"}</span>
            </div>
            <div class="desktop-row desktop-row--column">
                <span class="desktop-row__label">User ID</span>
                <span class="desktop-value desktop-mono">
                    {session?.userID ?? "-"}
                </span>
            </div>
            <div class="desktop-row desktop-row--column">
                <span class="desktop-row__label">Device ID</span>
                <span class="desktop-value desktop-mono">
                    {session?.deviceID ?? "-"}
                </span>
            </div>
            <div class="desktop-row">
                <span class="desktop-row__label">Token expires</span>
                <span class="desktop-value">
                    {session?.tokenExpiresAt ?? "Unknown"}
                </span>
            </div>
            <div class="desktop-row">
                <span class="desktop-row__label">Remaining hours</span>
                <span class="desktop-value">
                    {session?.tokenRemainingHours?.toFixed(1) ?? "Unknown"}
                </span>
            </div>
        </section>
    </main>
</div>
