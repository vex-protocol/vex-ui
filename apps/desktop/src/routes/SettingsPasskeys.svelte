<script lang="ts">
    import type { Passkey } from "@vex-chat/libvex";

    import { onDestroy, onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import {
        ArrowLeft,
        KeyRound,
        Plus,
        RefreshCw,
        Trash2,
        X,
    } from "@lucide/svelte";

    import {
        getBrowserPasskeyHandoff,
        openBrowserPasskeyHandoff,
    } from "../lib/browserPasskey.js";
    import { registerPasskey } from "../lib/passkey.js";
    import { vexService } from "../lib/store/index.js";
    import "../settings-detail.css";

    let passkeys: Passkey[] = $state([]);
    let loading = $state(false);
    let error = $state("");
    let notice = $state("");
    let name = $state("");
    let busy = $state(false);
    let browserWait: AbortController | null = $state.raw(null);
    let deleteConfirmID: null | string = $state(null);

    function sortPasskeys(next: Passkey[]): Passkey[] {
        return [...next].sort(
            (a, b) =>
                new Date(b.lastUsedAt ?? b.createdAt).getTime() -
                new Date(a.lastUsedAt ?? a.createdAt).getTime(),
        );
    }

    async function loadPasskeys(): Promise<void> {
        loading = true;
        error = "";
        try {
            passkeys = sortPasskeys(await vexService.listPasskeys());
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Could not load passkeys.";
        } finally {
            loading = false;
        }
    }

    async function addPasskey(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const passkeyName = name.trim();
        if (!passkeyName) {
            error = "Give the passkey a name you will recognize.";
            return;
        }

        busy = true;
        error = "";
        notice = "";
        const existingPasskeyIDs = new Set(
            passkeys.map((passkey) => passkey.passkeyID),
        );
        const controller = new AbortController();
        try {
            const begin =
                await vexService.beginPasskeyRegistration(passkeyName);
            const browserHandoff = getBrowserPasskeyHandoff(begin.options);
            if (browserHandoff) {
                browserWait = controller;
                await openBrowserPasskeyHandoff(browserHandoff);
                notice = "Finish creating the passkey in your browser.";
                const added = await waitForNewPasskey(
                    existingPasskeyIDs,
                    Date.parse(browserHandoff.expiresAt),
                    controller.signal,
                );
                name = "";
                notice = `${added.name} added.`;
                return;
            }
            if ("__TAURI_INTERNALS__" in window) {
                throw new Error(
                    "This server needs the desktop passkey bridge update.",
                );
            }
            const response = await registerPasskey(begin.options);
            const result = await vexService.finishPasskeyRegistration({
                name: passkeyName,
                requestID: begin.requestID,
                response,
            });
            if (!result.ok) {
                error = result.error ?? "Could not register the passkey.";
                return;
            }
            name = "";
            notice = "Passkey added.";
            await loadPasskeys();
        } catch (err: unknown) {
            if (isAbortError(err)) return;
            error =
                err instanceof Error
                    ? err.message
                    : "Could not register the passkey.";
        } finally {
            if (browserWait === controller) browserWait = null;
            busy = false;
        }
    }

    function cancelPasskeyWait(): void {
        browserWait?.abort();
        browserWait = null;
        busy = false;
        notice = "";
    }

    async function waitForNewPasskey(
        existingPasskeyIDs: Set<string>,
        expiresAt: number,
        signal: AbortSignal,
    ): Promise<Passkey> {
        while (Date.now() < expiresAt) {
            await sleep(900, signal);
            const next = sortPasskeys(await vexService.listPasskeys());
            passkeys = next;
            const added = next.find(
                (passkey) => !existingPasskeyIDs.has(passkey.passkeyID),
            );
            if (added) return added;
        }
        throw new Error(
            "Passkey setup expired. Start again when you are ready.",
        );
    }

    function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                signal.removeEventListener("abort", abort);
                resolve();
            }, milliseconds);
            const abort = (): void => {
                window.clearTimeout(timer);
                reject(new DOMException("Cancelled", "AbortError"));
            };
            signal.addEventListener("abort", abort, { once: true });
        });
    }

    function isAbortError(error: unknown): boolean {
        return error instanceof DOMException && error.name === "AbortError";
    }

    async function deletePasskey(passkeyID: string): Promise<void> {
        error = "";
        const result = await vexService.deletePasskey(passkeyID);
        if (!result.ok) {
            error = result.error ?? "Could not remove the passkey.";
            return;
        }
        deleteConfirmID = null;
        notice = "Passkey removed.";
        await loadPasskeys();
    }

    onMount(() => {
        void loadPasskeys();
    });

    onDestroy(() => {
        browserWait?.abort();
    });
</script>

<div class="settings-detail">
    <header class="settings-detail__header">
        <button
            class="settings-detail__back"
            type="button"
            aria-label="Back to settings"
            onclick={() => void push("/settings?tab=account")}
        >
            <ArrowLeft size={19} />
        </button>
        <div class="settings-detail__heading">
            <span>Account security</span>
            <h1>Passkeys</h1>
        </div>
    </header>

    <div class="settings-detail__scroll">
        <main class="settings-detail__body">
            <div class="settings-detail__intro">
                <span class="settings-detail__intro-icon">
                    <KeyRound size={20} />
                </span>
                <div>
                    <h2>Passkeys</h2>
                    <p>
                        Passkeys supplement your password with device-bound
                        biometric or security-key authentication.
                    </p>
                </div>
            </div>

            <section class="settings-detail__section">
                <div class="settings-detail__section-header">
                    <h3>Your passkeys</h3>
                    <button
                        class="settings-detail__icon-button"
                        type="button"
                        aria-label="Refresh passkeys"
                        title="Refresh passkeys"
                        onclick={loadPasskeys}
                        disabled={loading}
                    >
                        <RefreshCw size={15} />
                    </button>
                </div>

                <div class="settings-detail__list">
                    {#if loading && passkeys.length === 0}
                        <p class="settings-detail__empty">
                            Loading passkeys...
                        </p>
                    {:else if passkeys.length === 0}
                        <p class="settings-detail__empty">
                            No passkeys added. Your password remains the
                            required sign-in method.
                        </p>
                    {:else}
                        {#each passkeys as passkey (passkey.passkeyID)}
                            <div class="settings-detail__row">
                                <div class="settings-detail__row-info">
                                    <strong>{passkey.name}</strong>
                                    <span>
                                        {passkey.lastUsedAt
                                            ? `Last used ${new Date(passkey.lastUsedAt).toLocaleString()}`
                                            : `Added ${new Date(passkey.createdAt).toLocaleString()}`}
                                    </span>
                                </div>
                                {#if deleteConfirmID === passkey.passkeyID}
                                    <div class="settings-detail__confirm">
                                        <button
                                            class="settings-detail__button settings-detail__button--danger"
                                            type="button"
                                            onclick={() =>
                                                void deletePasskey(
                                                    passkey.passkeyID,
                                                )}
                                        >
                                            Remove
                                        </button>
                                        <button
                                            class="settings-detail__icon-button"
                                            type="button"
                                            aria-label="Cancel removal"
                                            onclick={() =>
                                                (deleteConfirmID = null)}
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                {:else}
                                    <button
                                        class="settings-detail__icon-button"
                                        type="button"
                                        aria-label={`Remove ${passkey.name}`}
                                        title={`Remove ${passkey.name}`}
                                        onclick={() =>
                                            (deleteConfirmID =
                                                passkey.passkeyID)}
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </div>
            </section>

            <section class="settings-detail__section">
                <div class="settings-detail__section-header">
                    <h3>Add a passkey</h3>
                </div>
                <form class="settings-detail__form" onsubmit={addPasskey}>
                    <div class="settings-detail__field">
                        <label for="passkey-name">Passkey name</label>
                        <div class="settings-detail__inline-form">
                            <input
                                id="passkey-name"
                                type="text"
                                autocomplete="off"
                                maxlength="64"
                                placeholder="MacBook Touch ID"
                                bind:value={name}
                                disabled={busy}
                            />
                            <button
                                class="settings-detail__button settings-detail__button--primary"
                                type="submit"
                                disabled={busy || !name.trim()}
                            >
                                <Plus size={15} />
                                {browserWait
                                    ? "Waiting..."
                                    : busy
                                      ? "Verifying..."
                                      : "Add passkey"}
                            </button>
                            {#if browserWait}
                                <button
                                    class="settings-detail__button"
                                    type="button"
                                    onclick={cancelPasskeyWait}
                                >
                                    Cancel
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if error}
                        <p
                            class="settings-detail__status settings-detail__status--error"
                            role="alert"
                        >
                            {error}
                        </p>
                    {:else if notice}
                        <p
                            class="settings-detail__status settings-detail__status--success"
                            role="status"
                        >
                            {notice}
                        </p>
                    {/if}
                </form>
            </section>
        </main>
    </div>
</div>
