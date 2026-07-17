<script lang="ts">
    import {
        ArrowRight,
        Link,
        MessageCircle,
        Plus,
        ShieldCheck,
    } from "@lucide/svelte";

    import CreateServerModal from "../lib/CreateServerModal.svelte";

    let groupMode: "create" | "join" = $state("create");
    let showGroups = $state(false);
</script>

<section class="inbox-home">
    <header class="inbox-home__topbar">
        <div>
            <span>Inbox</span>
            <strong>Direct messages</strong>
        </div>
        <ShieldCheck size={19} />
    </header>

    <div class="inbox-home__body">
        <div class="inbox-home__intro">
            <span class="inbox-home__mark">
                <MessageCircle size={26} strokeWidth={1.8} />
            </span>
            <h1>Your conversations start here</h1>
            <p>
                Find someone by username in the sidebar, or make a private group
                for a longer-running conversation.
            </p>
        </div>

        <div class="inbox-home__actions">
            <button
                type="button"
                onclick={() => {
                    groupMode = "create";
                    showGroups = true;
                }}
            >
                <span class="inbox-home__action-icon">
                    <Plus size={19} />
                </span>
                <span>
                    <strong>Create a group</strong>
                    <small>Start with a private #general channel</small>
                </span>
                <ArrowRight size={18} />
            </button>
            <button
                type="button"
                onclick={() => {
                    groupMode = "join";
                    showGroups = true;
                }}
            >
                <span
                    class="inbox-home__action-icon inbox-home__action-icon--green"
                >
                    <Link size={18} />
                </span>
                <span>
                    <strong>Join with an invite</strong>
                    <small>Paste a Vex link or invite code</small>
                </span>
                <ArrowRight size={18} />
            </button>
        </div>

        <p class="inbox-home__privacy">
            <ShieldCheck size={14} />
            Message content remains end-to-end encrypted between approved devices.
        </p>
    </div>
</section>

{#if showGroups}
    <CreateServerModal
        initialMode={groupMode}
        onclose={() => (showGroups = false)}
    />
{/if}

<style>
    .inbox-home {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .inbox-home__topbar {
        height: var(--topbar-height);
        flex: 0 0 var(--topbar-height);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 18px;
        border-bottom: 1px solid var(--border);
        background: color-mix(
            in srgb,
            var(--bg-primary) 92%,
            var(--bg-secondary)
        );
    }

    .inbox-home__topbar div {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .inbox-home__topbar span {
        color: var(--text-faint);
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .inbox-home__topbar strong {
        font-family: var(--font-heading);
        font-size: 14px;
    }

    .inbox-home__topbar :global(svg) {
        color: var(--success);
    }

    .inbox-home__body {
        width: min(600px, calc(100% - 48px));
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-self: center;
        padding: 36px 0 52px;
    }

    .inbox-home__intro {
        margin-bottom: 28px;
    }

    .inbox-home__mark {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        margin-bottom: 18px;
        border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
        border-radius: 8px;
        background: var(--accent-soft);
        color: var(--accent-text);
    }

    .inbox-home__intro h1 {
        margin-bottom: 8px;
        font-family: var(--font-heading);
        font-size: 28px;
        line-height: 1.15;
    }

    .inbox-home__intro p {
        max-width: 500px;
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.65;
    }

    .inbox-home__actions {
        border-top: 1px solid var(--border);
    }

    .inbox-home__actions button {
        width: 100%;
        min-height: 72px;
        display: flex;
        align-items: center;
        gap: 13px;
        padding: 11px 4px;
        border-bottom: 1px solid var(--border);
        text-align: left;
    }

    .inbox-home__actions button:hover {
        color: var(--text-primary);
    }

    .inbox-home__actions button > span:nth-child(2) {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .inbox-home__actions strong {
        color: var(--text-secondary);
        font-size: 13px;
    }

    .inbox-home__actions small {
        color: var(--text-faint);
        font-size: 11px;
    }

    .inbox-home__actions button > :global(svg) {
        color: var(--text-faint);
        transition: transform 140ms ease;
    }

    .inbox-home__actions button:hover > :global(svg) {
        transform: translateX(2px);
    }

    .inbox-home__action-icon {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: var(--accent-soft);
        color: var(--accent-text);
    }

    .inbox-home__action-icon--green {
        background: color-mix(in srgb, var(--success) 13%, transparent);
        color: var(--success);
    }

    .inbox-home__privacy {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-top: 20px;
        color: var(--text-faint);
        font-size: 10px;
        line-height: 1.45;
    }

    .inbox-home__privacy :global(svg) {
        flex: 0 0 auto;
        color: var(--success);
    }
</style>
