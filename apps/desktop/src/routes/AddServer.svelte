<script lang="ts">
    import { push } from "svelte-spa-router";

    import { parseInviteID, vexService } from "../lib/store/index.js";

    let mode: "create" | "join" | "pick" = $state("pick");
    let serverName = $state("");
    let inviteInput = $state("");
    let loading = $state(false);
    let error = $state("");

    async function createServer(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        const name = serverName.trim();
        if (!name || loading) return;
        loading = true;
        error = "";
        try {
            const result = await vexService.createServer(name);
            if (!result.ok) {
                error = result.error ?? "Failed to create server.";
                return;
            }
            navigateToServerResult(result);
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to create server.";
        } finally {
            loading = false;
        }
    }

    async function joinServer(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        const inviteID = parseInviteID(inviteInput);
        if (!inviteID) {
            error = "Please enter a valid invite link or code.";
            return;
        }
        loading = true;
        error = "";
        try {
            const result = await vexService.joinInvite(inviteID);
            if (!result.ok) {
                error = result.error ?? "Failed to join server.";
                return;
            }
            navigateToServerResult(result);
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to join server.";
        } finally {
            loading = false;
        }
    }

    function navigateToServerResult(result: {
        channelID?: string;
        serverID?: string;
    }): void {
        if (result.serverID && result.channelID) {
            void push(`/server/${result.serverID}/${result.channelID}`);
            return;
        }
        if (result.serverID) {
            void push(`/server/${result.serverID}`);
            return;
        }
        void push("/home");
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
                <h1 class="desktop-page__title">Add a Server</h1>
                <p class="desktop-page__subtitle">
                    Create your own group or join with an invite.
                </p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body add-server">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        {#if mode === "pick"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Choose action</h2>
                <button
                    class="desktop-row settings-link"
                    onclick={() => {
                        mode = "create";
                        error = "";
                    }}
                >
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Create a server</span>
                        <span class="desktop-row__desc">
                            Start a new group with a default channel.
                        </span>
                    </div>
                    <span class="chevron">›</span>
                </button>
                <button
                    class="desktop-row settings-link"
                    onclick={() => {
                        mode = "join";
                        error = "";
                    }}
                >
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Join via invite</span>
                        <span class="desktop-row__desc">
                            Paste an invite link or code.
                        </span>
                    </div>
                    <span class="chevron">›</span>
                </button>
            </section>
        {:else if mode === "create"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Create server</h2>
                <form
                    class="desktop-row desktop-row--column"
                    onsubmit={createServer}
                >
                    <label class="desktop-row__label" for="server-name">
                        Server name
                    </label>
                    <div class="desktop-input-row">
                        <input
                            id="server-name"
                            bind:value={serverName}
                            placeholder="My server"
                            disabled={loading}
                        />
                        <button
                            class="desktop-button desktop-button--primary"
                            type="submit"
                            disabled={!serverName.trim() || loading}
                        >
                            {loading ? "Creating..." : "Create"}
                        </button>
                    </div>
                    <button
                        class="desktop-button add-server__secondary"
                        type="button"
                        onclick={() => {
                            mode = "pick";
                        }}
                    >
                        Back
                    </button>
                </form>
            </section>
        {:else}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Join server</h2>
                <form
                    class="desktop-row desktop-row--column"
                    onsubmit={joinServer}
                >
                    <label class="desktop-row__label" for="invite-input">
                        Invite link or code
                    </label>
                    <div class="desktop-input-row">
                        <input
                            id="invite-input"
                            bind:value={inviteInput}
                            placeholder="Paste invite link or code"
                            disabled={loading}
                        />
                        <button
                            class="desktop-button desktop-button--primary"
                            type="submit"
                            disabled={!inviteInput.trim() || loading}
                        >
                            {loading ? "Joining..." : "Join"}
                        </button>
                    </div>
                    <button
                        class="desktop-button add-server__secondary"
                        type="button"
                        onclick={() => {
                            mode = "pick";
                        }}
                    >
                        Back
                    </button>
                </form>
            </section>
        {/if}
    </main>
</div>

<style>
    .settings-link {
        width: 100%;
        color: inherit;
        text-align: left;
    }

    .settings-link:hover {
        background: var(--bg-hover);
    }

    .chevron {
        color: var(--text-muted);
        font-size: 22px;
    }

    .add-server__secondary {
        align-self: flex-start;
        margin-top: 4px;
    }
</style>
