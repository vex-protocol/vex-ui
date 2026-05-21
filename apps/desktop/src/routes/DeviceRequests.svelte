<script lang="ts">
    import type { DeviceApprovalRequest } from "../lib/store/index.js";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import { matchingCodeForSignKey } from "../lib/deviceApprovalCode.js";
    import { vexService } from "../lib/store/index.js";

    let requests: DeviceApprovalRequest[] = $state([]);
    let loading = $state(true);
    let error = $state("");
    let busyByRequest: Record<string, boolean> = $state({});

    async function refresh(): Promise<void> {
        loading = true;
        error = "";
        try {
            const loaded = await vexService.listPendingDeviceRequests();
            requests = loaded.filter((request) => request.status === "pending");
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to load device requests.";
        } finally {
            loading = false;
        }
    }

    async function approve(requestID: string): Promise<void> {
        busyByRequest = { ...busyByRequest, [requestID]: true };
        error = "";
        try {
            const result = await vexService.approveDeviceRequest(requestID);
            if (!result.ok) {
                error = result.error ?? "Failed to approve request.";
                return;
            }
            await refresh();
        } finally {
            busyByRequest = { ...busyByRequest, [requestID]: false };
        }
    }

    async function reject(requestID: string): Promise<void> {
        busyByRequest = { ...busyByRequest, [requestID]: true };
        error = "";
        try {
            const result = await vexService.rejectDeviceRequest(requestID);
            if (!result.ok) {
                error = result.error ?? "Failed to reject request.";
                return;
            }
            await refresh();
        } finally {
            busyByRequest = { ...busyByRequest, [requestID]: false };
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
        if (Number.isNaN(date.getTime())) return "recently";
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
                <h1 class="desktop-page__title">Device Requests</h1>
                <p class="desktop-page__subtitle">
                    Approve new devices by matching the code shown there.
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
            <h2 class="desktop-section__title">Pending requests</h2>
            {#if loading && requests.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">Loading requests...</span>
                </div>
            {:else if requests.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">No pending requests.</span>
                </div>
            {:else}
                {#each requests as request (request.requestID)}
                    {@const busy = busyByRequest[request.requestID]}
                    <div class="desktop-row desktop-row--column request-card">
                        <div class="request-card__header">
                            <div class="desktop-row__info">
                                <span class="desktop-row__label">
                                    {request.deviceName || "New device"}
                                </span>
                                <span class="desktop-row__desc">
                                    @{request.username} requested {formatDate(
                                        request.createdAt,
                                    )}
                                </span>
                            </div>
                            <span class="desktop-mono desktop-muted">
                                {request.requestID.slice(0, 8)}...
                            </span>
                        </div>

                        <p class="desktop-muted">
                            Confirm these four characters match the new device.
                        </p>
                        <div class="approval-code">
                            {#each matchingCodeForSignKey(request.signKey) as char, index (index)}
                                <span class="approval-code__cell">
                                    {char}
                                </span>
                            {/each}
                        </div>

                        <div class="desktop-actions request-card__actions">
                            <button
                                class="desktop-button"
                                onclick={() => void reject(request.requestID)}
                                disabled={busy}
                            >
                                Reject
                            </button>
                            <button
                                class="desktop-button desktop-button--primary"
                                onclick={() => void approve(request.requestID)}
                                disabled={busy}
                            >
                                {busy ? "Working..." : "Approve"}
                            </button>
                        </div>
                    </div>
                {/each}
            {/if}
        </section>
    </main>
</div>

<style>
    .request-card {
        align-items: stretch;
        gap: 12px;
    }

    .request-card__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
    }

    .approval-code {
        display: flex;
        gap: 10px;
    }

    .approval-code__cell {
        width: 48px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: var(--text-primary);
        font-size: 24px;
        font-weight: 700;
        font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
    }

    .request-card__actions {
        justify-content: flex-end;
    }
</style>
