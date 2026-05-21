<script lang="ts">
    import type { SessionInfo } from "../lib/store/index.js";
    import type { Device } from "@vex-chat/libvex";

    import { push } from "svelte-spa-router";

    import { vexService } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const deviceID = $derived(params.deviceID ?? "");
    let device = $state<Device | null>(null);
    let deviceCount = $state(0);
    let session = $state<null | SessionInfo>(null);
    let loading = $state(true);
    let busy = $state(false);
    let error = $state("");
    let confirmRemove = $state(false);

    $effect(() => {
        if (!deviceID) return;
        void refresh();
    });

    async function refresh(): Promise<void> {
        loading = true;
        error = "";
        try {
            const [nextSession, devices] = await Promise.all([
                vexService.getSessionInfo(),
                vexService.listMyDevices(),
            ]);
            session = nextSession;
            deviceCount = devices.length;
            device =
                devices.find((entry) => entry.deviceID === deviceID) ?? null;
            if (!device) {
                error = "Device no longer exists.";
            }
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to load device details.";
        } finally {
            loading = false;
        }
    }

    async function removeDevice(): Promise<void> {
        if (!device || busy || !canRemove) return;
        busy = true;
        error = "";
        try {
            const result = await vexService.removeDevice(device.deviceID);
            if (!result.ok) {
                error = result.error ?? "Failed to remove device.";
                return;
            }
            void push("/devices");
        } finally {
            busy = false;
        }
    }

    const isCurrent = $derived(device?.deviceID === session?.deviceID);
    const canRemove = $derived(
        Boolean(device) && !isCurrent && deviceCount > 1,
    );
    const removeHelper = $derived(
        isCurrent
            ? "Cannot remove the device currently in use."
            : deviceCount <= 1
              ? "Cannot remove your last remaining device."
              : "Sign this device out everywhere.",
    );

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
                onclick={() => void push("/devices")}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">
                    {device?.name ?? "Device details"}
                </h1>
                <p class="desktop-page__subtitle">{deviceID}</p>
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
            <h2 class="desktop-section__title">Details</h2>
            <div class="desktop-row">
                <span class="desktop-row__label">Name</span>
                <span class="desktop-value">{device?.name ?? "Unknown"}</span>
            </div>
            <div class="desktop-row desktop-row--column">
                <span class="desktop-row__label">Device ID</span>
                <span class="desktop-value desktop-mono"
                    >{device?.deviceID ?? deviceID}</span
                >
            </div>
            <div class="desktop-row">
                <span class="desktop-row__label">Last login</span>
                <span class="desktop-value">
                    {device?.lastLogin
                        ? formatDate(device.lastLogin)
                        : "Unknown"}
                </span>
            </div>
            <div class="desktop-row">
                <span class="desktop-row__label">Current device</span>
                <span class="desktop-value">{isCurrent ? "Yes" : "No"}</span>
            </div>
        </section>

        <section class="desktop-section">
            <h2 class="desktop-section__title">Actions</h2>
            <div class="desktop-row">
                <div class="desktop-row__info">
                    <span class="desktop-row__label">Remove device</span>
                    <span class="desktop-row__desc">{removeHelper}</span>
                </div>
                {#if confirmRemove}
                    <div class="desktop-actions">
                        <button
                            class="desktop-button desktop-button--danger"
                            onclick={() => void removeDevice()}
                            disabled={!canRemove || busy}
                        >
                            {busy ? "Removing..." : "Remove"}
                        </button>
                        <button
                            class="desktop-button"
                            onclick={() => {
                                confirmRemove = false;
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
                            confirmRemove = true;
                        }}
                        disabled={!canRemove || loading}
                    >
                        Remove
                    </button>
                {/if}
            </div>
        </section>
    </main>
</div>
