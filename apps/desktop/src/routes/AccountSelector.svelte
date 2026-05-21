<script lang="ts">
    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import {
        clearCredentials,
        type KnownAccount,
        listKnownAccounts,
        setActiveUsername,
    } from "../lib/keystore.js";

    let accounts: KnownAccount[] = $state([]);
    let loading = $state(true);
    let busyUsername: null | string = $state(null);
    let error = $state("");
    let confirmRemove: null | string = $state(null);

    async function refresh(): Promise<void> {
        loading = true;
        try {
            accounts = await listKnownAccounts();
        } finally {
            loading = false;
        }
    }

    async function selectAccount(username: string): Promise<void> {
        if (busyUsername) return;
        busyUsername = username;
        error = "";
        try {
            await setActiveUsername(username);
            void push("/launch");
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Could not activate account.";
            await refresh();
        } finally {
            busyUsername = null;
        }
    }

    async function removeAccount(username: string): Promise<void> {
        busyUsername = username;
        error = "";
        try {
            await clearCredentials(username);
            confirmRemove = null;
            await refresh();
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Could not remove account.";
        } finally {
            busyUsername = null;
        }
    }

    onMount(() => {
        void refresh();
    });
</script>

<div class="accounts-page">
    <div class="accounts-card">
        <h1 class="accounts-card__title">Choose account</h1>
        <p class="accounts-card__subtitle">
            Use a saved device key or sign in with another account.
        </p>

        {#if error}
            <p class="accounts-card__error">{error}</p>
        {/if}

        {#if loading}
            <p class="accounts-card__empty">Loading accounts...</p>
        {:else if accounts.length === 0}
            <p class="accounts-card__empty">
                No saved accounts on this desktop.
            </p>
        {:else}
            <ul class="accounts-list">
                {#each accounts as account (account.username)}
                    <li class="accounts-list__item">
                        <button
                            class="accounts-list__main"
                            onclick={() => void selectAccount(account.username)}
                            disabled={busyUsername !== null}
                        >
                            <span class="accounts-list__avatar">
                                {account.username[0]?.toUpperCase() ?? "?"}
                            </span>
                            <span class="accounts-list__name">
                                @{account.username}
                            </span>
                            <span class="accounts-list__status">
                                {busyUsername === account.username
                                    ? "Signing in..."
                                    : "Sign in"}
                            </span>
                        </button>
                        {#if confirmRemove === account.username}
                            <div class="accounts-list__confirm">
                                <button
                                    class="accounts-list__danger"
                                    onclick={() =>
                                        void removeAccount(account.username)}
                                    disabled={busyUsername !== null}
                                >
                                    Remove
                                </button>
                                <button
                                    class="accounts-list__secondary"
                                    onclick={() => {
                                        confirmRemove = null;
                                    }}
                                    disabled={busyUsername !== null}
                                >
                                    Cancel
                                </button>
                            </div>
                        {:else}
                            <button
                                class="accounts-list__remove"
                                title="Remove saved account"
                                aria-label={`Remove ${account.username}`}
                                onclick={() => {
                                    confirmRemove = account.username;
                                }}
                                disabled={busyUsername !== null}
                            >
                                Remove
                            </button>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}

        <div class="accounts-card__actions">
            <button
                class="accounts-card__primary"
                onclick={() => void push("/login")}
            >
                Sign in with another account
            </button>
            <button
                class="accounts-card__secondary"
                onclick={() => void push("/register")}
            >
                Create account
            </button>
        </div>
    </div>
</div>

<style>
    .accounts-page {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
        padding: 24px;
    }

    .accounts-card {
        width: min(440px, 100%);
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 28px;
    }

    .accounts-card__title {
        font-size: 22px;
        color: var(--text-primary);
    }

    .accounts-card__subtitle,
    .accounts-card__empty {
        color: var(--text-secondary);
        font-size: 13px;
        line-height: 1.45;
    }

    .accounts-card__error {
        padding: 8px 10px;
        border: 1px solid var(--danger);
        border-radius: 4px;
        color: var(--danger);
        background: color-mix(in srgb, var(--danger) 14%, transparent);
        font-size: 13px;
    }

    .accounts-list {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .accounts-list__item {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .accounts-list__main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-primary);
        text-align: left;
    }

    .accounts-list__main:hover:not(:disabled) {
        background: var(--bg-hover);
    }

    .accounts-list__avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--accent);
        color: #fff;
        font-weight: 700;
        flex-shrink: 0;
    }

    .accounts-list__name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }

    .accounts-list__status {
        color: var(--text-muted);
        font-size: 12px;
    }

    .accounts-list__remove,
    .accounts-list__secondary,
    .accounts-list__danger,
    .accounts-card__primary,
    .accounts-card__secondary {
        padding: 8px 12px;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
    }

    .accounts-list__remove,
    .accounts-list__danger {
        color: var(--danger);
        border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    }

    .accounts-list__danger:hover:not(:disabled),
    .accounts-list__remove:hover:not(:disabled) {
        background: var(--danger);
        color: #fff;
    }

    .accounts-list__confirm {
        display: flex;
        gap: 6px;
    }

    .accounts-card__actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .accounts-card__primary {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
    }

    .accounts-card__primary:hover,
    .accounts-card__secondary:hover {
        opacity: 0.9;
    }

    button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
</style>
