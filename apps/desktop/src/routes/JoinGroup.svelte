<script lang="ts">
    import { push } from "svelte-spa-router";

    import { parseInviteID, vexService } from "../lib/store/index.js";

    let { params = {} }: { params?: Record<string, string> } = $props();

    let input = $state("");
    let loading = $state(false);
    let error = $state("");

    $effect(() => {
        if (params.inviteID && input.length === 0) {
            input = params.inviteID;
        }
    });

    async function join(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        const inviteID = parseInviteID(input);
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
            if (result.serverID && result.channelID) {
                void push(`/server/${result.serverID}/${result.channelID}`);
                return;
            }
            void push(result.serverID ? `/server/${result.serverID}` : "/home");
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to join server.";
        } finally {
            loading = false;
        }
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
                <h1 class="desktop-page__title">Join a Group</h1>
                <p class="desktop-page__subtitle">
                    Enter an invite link or code.
                </p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body">
        {#if error}
            <div class="desktop-status desktop-status--error">{error}</div>
        {/if}

        <section class="desktop-section">
            <h2 class="desktop-section__title">Invite</h2>
            <form class="desktop-row desktop-row--column" onsubmit={join}>
                <label class="desktop-row__label" for="join-invite">
                    Invite link or code
                </label>
                <div class="desktop-input-row">
                    <input
                        id="join-invite"
                        bind:value={input}
                        placeholder="Paste invite link or code"
                        disabled={loading}
                    />
                    <button
                        class="desktop-button desktop-button--primary"
                        type="submit"
                        disabled={!input.trim() || loading}
                    >
                        {loading ? "Joining..." : "Join"}
                    </button>
                </div>
            </form>
        </section>
    </main>
</div>
