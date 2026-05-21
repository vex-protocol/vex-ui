<script lang="ts">
    import { push } from "svelte-spa-router";

    import CreateServerModal from "../lib/CreateServerModal.svelte";
    import { parseInviteID, vexService } from "../lib/store/index.js";

    let showCreate = $state(false);
    let inviteInput = $state("");
    let joinError = $state("");
    let joining = $state(false);

    async function joinViaInvite(e: Event): Promise<void> {
        e.preventDefault();
        const inviteID = parseInviteID(inviteInput);
        if (!inviteID) {
            joinError = "Please enter a valid invite link or code";
            return;
        }
        joining = true;
        joinError = "";
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok) {
                joinError = result.error ?? "Failed to join server";
                return;
            }
            if (result.serverID && result.channelID) {
                void push(`/server/${result.serverID}/${result.channelID}`);
            } else if (result.serverID) {
                void push(`/server/${result.serverID}`);
            } else {
                void push("/home");
            }
        } catch (err: unknown) {
            joinError =
                err instanceof Error ? err.message : "Failed to join server";
        } finally {
            joining = false;
        }
    }
</script>

<div class="home">
    <div class="home__card">
        <h1 class="home__title">Welcome to Vex</h1>
        <p class="home__subtitle">
            Create a server or join one with an invite link.
        </p>

        <button
            class="home__create"
            onclick={() => {
                showCreate = true;
            }}
        >
            Create a Server
        </button>

        <div class="home__divider">
            <span class="home__divider-text">or</span>
        </div>

        <form class="home__join" onsubmit={joinViaInvite}>
            <input
                class="home__join-input"
                type="text"
                placeholder="Paste invite link or code"
                bind:value={inviteInput}
                disabled={joining}
                autocomplete="off"
            />
            <button
                class="home__join-btn"
                type="submit"
                disabled={!inviteInput.trim() || joining}
            >
                {joining ? "Joining…" : "Join"}
            </button>
        </form>
        {#if joinError}
            <p class="home__error">{joinError}</p>
        {/if}
    </div>
</div>

{#if showCreate}
    <CreateServerModal
        onclose={() => {
            showCreate = false;
        }}
    />
{/if}

<style>
    .home {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
    }

    .home__card {
        text-align: center;
        max-width: 360px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
    }

    .home__title {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .home__subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .home__create {
        margin-top: 8px;
        background: var(--accent);
        color: #fff;
        padding: 10px 24px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
        transition: opacity 0.15s;
    }

    .home__create:hover {
        opacity: 0.9;
    }

    .home__divider {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 4px 0;
    }

    .home__divider::before,
    .home__divider::after {
        content: "";
        flex: 1;
        height: 1px;
        background: var(--border);
    }

    .home__divider-text {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .home__join {
        display: flex;
        gap: 8px;
        width: 100%;
    }

    .home__join-input {
        flex: 1;
        padding: 8px 10px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .home__join-input:focus {
        outline: none;
        border-color: var(--accent);
    }

    .home__join-btn {
        padding: 8px 16px;
        background: var(--success);
        color: #fff;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        flex-shrink: 0;
        transition: opacity 0.15s;
    }

    .home__join-btn:hover:not(:disabled) {
        opacity: 0.9;
    }
    .home__join-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .home__error {
        font-size: 12px;
        color: var(--danger);
        margin: 0;
    }
</style>
