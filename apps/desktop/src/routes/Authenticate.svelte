<script lang="ts">
    import { push } from "svelte-spa-router";

    import { matchingCodeForSignKey } from "../lib/deviceApprovalCode.js";
    import {
        pendingApprovalStage,
        user,
        vexService,
    } from "../lib/store/index.js";

    let { params }: { params: Record<string, string> } = $props();

    const requestID = $derived(params.requestID ?? "");
    const signKey = $derived(params.signKey ?? "");
    const codeChars = $derived(matchingCodeForSignKey(signKey));
    let secondsLeft = $state(5 * 60);
    let expired = $state(false);

    $effect(() => {
        if ($user) {
            void push("/home");
        }
    });

    $effect(() => {
        if (expired || $pendingApprovalStage !== "waiting") return;
        const timer = setInterval(() => {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                expired = true;
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    });

    const minutes = $derived(
        String(Math.floor(secondsLeft / 60)).padStart(2, "0"),
    );
    const seconds = $derived(String(secondsLeft % 60).padStart(2, "0"));

    function cancel(): void {
        vexService.cancelPendingApproval();
        void push("/login");
    }
</script>

<div class="auth-page">
    <div class="auth-card auth-card--wide">
        <h1 class="auth-card__title">Match this code</h1>
        <p class="auth-card__subtitle">
            Open Vex on a device where you are already signed in and approve
            request {requestID.slice(0, 8)}.
        </p>

        <div class="auth-code">
            {#each codeChars as char, index (index)}
                <span class="auth-code__cell">{char}</span>
            {/each}
        </div>

        {#if expired}
            <p class="auth-card__error">
                This verification expired. Start sign-in again to request a
                fresh code.
            </p>
        {:else if $pendingApprovalStage === "signing_in"}
            <p class="auth-status">Approved. Signing in...</p>
        {:else if $pendingApprovalStage === "loading_account"}
            <p class="auth-status">Loading your account...</p>
        {:else}
            <p class="auth-status">
                Waiting for approval. Expires in {minutes}:{seconds}
            </p>
        {/if}

        <div class="auth-actions">
            <button class="auth-secondary" onclick={cancel}>
                Back to sign in
            </button>
        </div>
    </div>
</div>

<style>
    .auth-page {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
        padding: 24px;
    }

    .auth-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 32px;
        width: 360px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .auth-card--wide {
        width: min(460px, 100%);
    }

    .auth-card__title {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .auth-card__subtitle,
    .auth-status {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .auth-card__error {
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        color: var(--danger);
        border: 1px solid var(--danger);
        border-radius: 4px;
        padding: 8px 12px;
        font-size: 13px;
    }

    .auth-code {
        display: flex;
        justify-content: center;
        gap: 12px;
        padding: 12px 0;
    }

    .auth-code__cell {
        width: 56px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: var(--text-primary);
        font-size: 28px;
        font-weight: 800;
        font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
    }

    .auth-actions {
        display: flex;
        justify-content: center;
    }

    .auth-secondary {
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        background: var(--bg-surface);
        font-size: 13px;
        font-weight: 600;
    }
</style>
