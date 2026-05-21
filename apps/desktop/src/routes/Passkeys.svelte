<script lang="ts">
    import type { Passkey } from "@vex-chat/libvex";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import {
        isPasskeySupported,
        PasskeyCancelledError,
        registerPasskey,
    } from "../lib/passkey.js";
    import { vexService } from "../lib/store/index.js";

    let passkeys: Passkey[] = $state([]);
    let loading = $state(true);
    let error = $state("");
    let addName = $state("");
    let addError = $state("");
    let submitting = $state(false);
    let deleteConfirmID: null | string = $state(null);

    const supported = isPasskeySupported();

    async function refresh(): Promise<void> {
        loading = true;
        error = "";
        try {
            const loaded = await vexService.listPasskeys();
            passkeys = [...loaded].sort((a, b) => {
                const aMs = new Date(a.lastUsedAt ?? a.createdAt).getTime();
                const bMs = new Date(b.lastUsedAt ?? b.createdAt).getTime();
                return bMs - aMs;
            });
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Could not load passkeys.";
        } finally {
            loading = false;
        }
    }

    async function addPasskey(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (submitting) return;
        const name = addName.trim();
        if (!supported) {
            addError = "Passkeys are not available in this desktop runtime.";
            return;
        }
        if (!name) {
            addError = "Give the passkey a recognizable name.";
            return;
        }
        submitting = true;
        addError = "";
        try {
            const begin = await vexService.beginPasskeyRegistration(name);
            const response = await registerPasskey(begin.options);
            const finish = await vexService.finishPasskeyRegistration({
                name,
                requestID: begin.requestID,
                response,
            });
            if (!finish.ok) {
                addError = finish.error ?? "Could not register passkey.";
                return;
            }
            addName = "";
            await refresh();
        } catch (err: unknown) {
            if (err instanceof PasskeyCancelledError) {
                return;
            }
            addError =
                err instanceof Error ? err.message : "Could not add passkey.";
        } finally {
            submitting = false;
        }
    }

    async function deletePasskey(passkeyID: string): Promise<void> {
        const result = await vexService.deletePasskey(passkeyID);
        if (!result.ok) {
            error = result.error ?? "Could not remove passkey.";
            return;
        }
        deleteConfirmID = null;
        await refresh();
    }

    onMount(() => {
        void refresh();
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
                onclick={() => void push("/settings")}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">Passkeys</h1>
                <p class="desktop-page__subtitle">
                    Recover and manage your account if you lose every device.
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
            <h2 class="desktop-section__title">Add a passkey</h2>
            <form class="desktop-row desktop-row--column" onsubmit={addPasskey}>
                <label class="desktop-row__label" for="passkey-name">Name</label
                >
                <div class="desktop-input-row">
                    <input
                        id="passkey-name"
                        bind:value={addName}
                        maxlength="64"
                        placeholder="MacBook, YubiKey, etc."
                        disabled={!supported || submitting}
                    />
                    <button
                        class="desktop-button desktop-button--primary"
                        type="submit"
                        disabled={!supported || submitting || !addName.trim()}
                    >
                        {submitting ? "Verifying..." : "Add passkey"}
                    </button>
                </div>
                {#if addError}
                    <span class="desktop-status desktop-status--error">
                        {addError}
                    </span>
                {:else}
                    <span class="desktop-muted">
                        {supported
                            ? "Uses the desktop WebAuthn prompt when this runtime supports it."
                            : "This desktop runtime does not expose WebAuthn passkey creation."}
                    </span>
                {/if}
            </form>
        </section>

        <section class="desktop-section">
            <h2 class="desktop-section__title">Your passkeys</h2>
            {#if loading && passkeys.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">Loading passkeys...</span>
                </div>
            {:else if passkeys.length === 0}
                <div class="desktop-row">
                    <span class="desktop-muted">No passkeys yet.</span>
                </div>
            {:else}
                {#each passkeys as passkey (passkey.passkeyID)}
                    <div class="desktop-row">
                        <div class="desktop-row__info">
                            <span class="desktop-row__label">
                                {passkey.name}
                            </span>
                            <span class="desktop-row__desc">
                                {passkey.lastUsedAt
                                    ? `Last used ${formatDate(passkey.lastUsedAt)}`
                                    : `Added ${formatDate(passkey.createdAt)}`}
                            </span>
                        </div>
                        {#if deleteConfirmID === passkey.passkeyID}
                            <div class="desktop-actions">
                                <button
                                    class="desktop-button desktop-button--danger"
                                    onclick={() =>
                                        void deletePasskey(passkey.passkeyID)}
                                >
                                    Remove
                                </button>
                                <button
                                    class="desktop-button"
                                    onclick={() => {
                                        deleteConfirmID = null;
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        {:else}
                            <button
                                class="desktop-button desktop-button--danger"
                                onclick={() => {
                                    deleteConfirmID = passkey.passkeyID;
                                }}
                            >
                                Remove
                            </button>
                        {/if}
                    </div>
                {/each}
            {/if}
        </section>
    </main>
</div>
