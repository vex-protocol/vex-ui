<script lang="ts">
    import type { Invite } from "@vex-chat/libvex";

    import { vexService } from "./store/index.js";

    let {
        onclose,
        serverID,
        serverName,
    }: { onclose: () => void; serverID?: string; serverName?: string } =
        $props();

    let invites: Invite[] = $state([]);
    let loading = $state(true);
    let creating = $state(false);
    let error = $state("");
    let copied = $state("");
    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    async function loadInvites(): Promise<void> {
        try {
            if (serverID) invites = await vexService.getInvites(serverID);
        } catch {
            // ignore — empty list is fine
        } finally {
            loading = false;
        }
    }

    async function createInvite(): Promise<void> {
        creating = true;
        error = "";
        try {
            if (!serverID) throw new Error("No server selected");
            const invite = await vexService.createInvite(serverID, "1h");
            invites = [invite, ...invites];
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Failed to create invite";
        } finally {
            creating = false;
        }
    }

    function copyLink(inviteID: string): void {
        void navigator.clipboard.writeText(inviteID);
        copied = inviteID;
        setTimeout(() => {
            if (copied === inviteID) copied = "";
        }, 2000);
    }

    function onkeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") onclose();
    }

    $effect(() => {
        if (serverID) void loadInvites();
    });
</script>

<svelte:window {onkeydown} />

<div class="modal-layer">
    <button
        class="modal-backdrop"
        type="button"
        aria-label="Close invite dialog"
        onclick={onclose}
    ></button>
    <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Invite people"
        tabindex="-1"
    >
        <h2 class="modal__title">Invite people to {serverName}</h2>

        <button
            use:focusOnMount
            class="invite__create-btn"
            onclick={createInvite}
            disabled={creating}
        >
            {creating ? "Creating…" : "Create Invite Link"}
        </button>

        {#if error}
            <p class="invite__error">{error}</p>
        {/if}

        {#if loading}
            <p class="invite__empty">Loading…</p>
        {:else if invites.length === 0}
            <p class="invite__empty">
                No active invite links. Create one above.
            </p>
        {:else}
            <ul class="invite__list">
                {#each invites as invite (invite.inviteID)}
                    <li class="invite__item">
                        <code class="invite__code">{invite.inviteID}</code>
                        <button
                            class="invite__copy-btn"
                            onclick={() => copyLink(invite.inviteID)}
                        >
                            {copied === invite.inviteID ? "Copied!" : "Copy"}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}

        <div class="modal__actions">
            <button class="modal__btn modal__btn--cancel" onclick={onclose}
                >Done</button
            >
        </div>
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
        background: rgba(0, 0, 0, 0.66);
        backdrop-filter: blur(6px);
        border: 0;
        inset: 0;
        padding: 0;
        position: absolute;
        animation: vex-fade 180ms var(--ease-out);
    }

    .modal {
        background: var(--bg-primary);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-pop);
        padding: 26px;
        width: 420px;
        max-width: 90vw;
        display: flex;
        flex-direction: column;
        gap: 15px;
        position: relative;
        z-index: 1;
        animation: vex-pop 240ms var(--ease-out);
    }

    .modal__title {
        font-family: var(--font-heading);
        font-size: 19px;
        font-weight: 700;
        letter-spacing: -0.015em;
        color: var(--text-primary);
        margin: 0;
    }

    .invite__create-btn {
        background: var(--accent);
        color: var(--on-accent);
        min-height: 40px;
        padding: 0 16px;
        border-radius: var(--radius-md);
        font-size: 12.5px;
        font-weight: 600;
        align-self: flex-start;
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            0 8px 20px -8px color-mix(in srgb, var(--accent) 55%, transparent);
        transition:
            background-color 140ms var(--ease-out),
            transform 100ms var(--ease-out);
    }

    .invite__create-btn:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .invite__create-btn:active:not(:disabled) {
        transform: translateY(1px);
    }

    .invite__create-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
    }

    .invite__error {
        font-size: 12px;
        color: var(--danger);
        margin: 0;
    }

    .invite__empty {
        font-size: 13px;
        color: var(--text-muted);
        font-style: italic;
        margin: 0;
    }

    .invite__list {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-height: 200px;
        overflow-y: auto;
    }

    .invite__item {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 7px 8px 7px 12px;
    }

    .invite__code {
        flex: 1;
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.02em;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .invite__copy-btn {
        flex-shrink: 0;
        min-height: 30px;
        padding: 0 12px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 600;
        background: var(--bg-hover);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        transition:
            background-color 120ms var(--ease-out),
            border-color 120ms var(--ease-out),
            color 120ms var(--ease-out);
    }

    .invite__copy-btn:hover {
        background: var(--accent);
        color: var(--on-accent);
        border-color: var(--accent);
    }

    .modal__actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 2px;
    }

    .modal__btn {
        min-height: 38px;
        padding: 0 16px;
        border-radius: var(--radius-md);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
    }

    .modal__btn--cancel {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-strong);
    }

    .modal__btn--cancel:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }
</style>
