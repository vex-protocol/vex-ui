<script lang="ts">
    import { push } from "svelte-spa-router";

    import { channels, servers, vexService } from "./store/index.js";

    let { onclose }: { onclose: () => void } = $props();

    let name = $state("");
    let error = $state("");
    let submitting = $state(false);
    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    async function submit(e: Event): Promise<void> {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        submitting = true;
        error = "";
        try {
            const result = await vexService.createServer(n);
            if (!result.ok) {
                error = result.error ?? "Failed to create server";
                return;
            }
            // VexService updates $servers and $channels atoms internally.
            // Find the newly added server to navigate to it.
            const allServers = Object.values(servers.get());
            const newServer = allServers[allServers.length - 1];
            onclose();
            if (newServer) {
                const serverChannels = channels.get()[newServer.serverID] ?? [];
                const firstChannel = serverChannels[0];
                if (firstChannel) {
                    void push(
                        `/server/${newServer.serverID}/${firstChannel.channelID}`,
                    );
                } else {
                    void push(`/server/${newServer.serverID}/`);
                }
            } else {
                void push("/home");
            }
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to create server";
        } finally {
            submitting = false;
        }
    }

    function onkeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") onclose();
    }
</script>

<svelte:window {onkeydown} />

<div class="modal-layer">
    <button
        class="modal-backdrop"
        type="button"
        aria-label="Close create server dialog"
        onclick={onclose}
    ></button>
    <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create server"
        tabindex="-1"
    >
        <h2 class="modal__title">Create a Server</h2>
        <form onsubmit={submit}>
            <label class="modal__label" for="server-name">Server Name</label>
            <input
                use:focusOnMount
                id="server-name"
                class="modal__input"
                type="text"
                bind:value={name}
                placeholder="My Awesome Server"
                maxlength={64}
                disabled={submitting}
                autocomplete="off"
            />
            {#if error}
                <p class="modal__error">{error}</p>
            {/if}
            <div class="modal__actions">
                <button
                    type="button"
                    class="modal__btn modal__btn--cancel"
                    onclick={onclose}
                    disabled={submitting}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    class="modal__btn modal__btn--submit"
                    disabled={!name.trim() || submitting}
                >
                    {submitting ? "Creating…" : "Create"}
                </button>
            </div>
        </form>
    </div>
</div>

<style>
    .modal-layer {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .modal-backdrop {
        background: rgba(0, 0, 0, 0.6);
        border: 0;
        inset: 0;
        padding: 0;
        position: absolute;
    }

    .modal {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 24px;
        width: 340px;
        max-width: 90vw;
        display: flex;
        flex-direction: column;
        gap: 16px;
        position: relative;
        z-index: 1;
    }

    .modal__title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    .modal__label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 6px;
    }

    .modal__input {
        width: 100%;
        padding: 8px 10px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 14px;
        box-sizing: border-box;
    }

    .modal__input:focus {
        outline: none;
        border-color: var(--accent);
    }

    .modal__error {
        font-size: 12px;
        color: var(--danger);
        margin: 0;
    }

    .modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
    }

    .modal__btn {
        padding: 7px 16px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }

    .modal__btn--cancel {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }

    .modal__btn--cancel:hover {
        background: var(--bg-hover);
    }

    .modal__btn--submit {
        background: var(--accent);
        color: #fff;
        border: none;
    }

    .modal__btn--submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .modal__btn--submit:not(:disabled):hover {
        filter: brightness(1.1);
    }
</style>
