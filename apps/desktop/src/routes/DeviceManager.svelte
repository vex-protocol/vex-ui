<script lang="ts">
    import type { SessionInfo } from "../lib/store/index.js";
    import type { Device } from "@vex-chat/libvex";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import { vexService } from "../lib/store/index.js";

    let devices: Device[] = $state([]);
    let session = $state<null | SessionInfo>(null);
    let loading = $state(true);
    let error = $state("");

    async function refresh(): Promise<void> {
        loading = true;
        error = "";
        try {
            const [nextSession, nextDevices] = await Promise.all([
                vexService.getSessionInfo(),
                vexService.listMyDevices(),
            ]);
            session = nextSession;
            devices = nextDevices;
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to load devices.";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        void refresh();
        const unsubscribe = vexService.onDeviceRequestQueueChanged(() => {
            void refresh();
        });
        return unsubscribe;
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
                onclick={() => history.back()}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">Device Manager</h1>
                <p class="desktop-page__subtitle">
                    Signed-in devices for this account.
                </p>
            </div>
        </div>
        <div class="desktop-actions">
            <button class="desktop-button" onclick={() => void refresh()}>
                {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
                class="desktop-button desktop-button--primary"
                onclick={() => void push("/device-requests")}
            >
                Pending requests
            </button>
        </div>
    </header>

    <main class="desktop-page__body">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Your devices</h2>
            {#if loading && devices.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">Loading devices...</span>
                </div>
            {:else if devices.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">No devices found.</span>
                </div>
            {:else}
                {#each devices as device (device.deviceID)}
                    {@const isCurrent = device.deviceID === session?.deviceID}
                    <div class="desktop-row">
                        <div class="desktop-row__info">
                            <span class="desktop-row__label">
                                {device.name || "Unnamed device"}
                                {#if isCurrent}
                                    <span class="device-badge">This device</span
                                    >
                                {/if}
                            </span>
                            <span class="desktop-row__desc">
                                Last login {formatDate(device.lastLogin)}
                            </span>
                            <span class="desktop-row__desc desktop-mono">
                                {device.deviceID}
                            </span>
                        </div>
                        <button
                            class="desktop-button"
                            onclick={() =>
                                void push(`/device/${device.deviceID}`)}
                        >
                            Details
                        </button>
                    </div>
                {/each}
            {/if}
        </section>
    </main>
</div>

<style>
    .device-badge {
        display: inline-flex;
        margin-left: 6px;
        padding: 2px 6px;
        border-radius: 999px;
        color: color-mix(in srgb, var(--success) 80%, white);
        background: color-mix(in srgb, var(--success) 16%, transparent);
        border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }
</style>
