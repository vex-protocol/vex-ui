<script lang="ts">
    import { push } from "svelte-spa-router";

    import { KeyRound, X } from "@lucide/svelte";

    import { passkeyUpgradePrompt, vexService } from "./store/index.js";

    const SETUP_INTENT_KEY = "vex-passkey-setup-intent";
    const SETUP_INTENT_EVENT = "vex-passkey-setup-intent";
    let closeButtonElement: HTMLButtonElement | null = $state(null);
    let primaryButtonElement: HTMLButtonElement | null = $state(null);

    function focusOnMount(node: HTMLButtonElement): { destroy(): void } {
        const previousFocus = document.activeElement;
        const frame = requestAnimationFrame(() => {
            node.focus();
        });
        return {
            destroy(): void {
                cancelAnimationFrame(frame);
                if (previousFocus instanceof HTMLElement) {
                    previousFocus.focus();
                }
            },
        };
    }

    function dismiss(): void {
        vexService.dismissPasskeyUpgradePrompt();
    }

    function startSetup(): void {
        const prompt = $passkeyUpgradePrompt;
        if (!prompt) return;
        sessionStorage.setItem(
            SETUP_INTENT_KEY,
            JSON.stringify({
                reason: prompt.reason,
                suggestedName: passkeyNameForDevice(prompt.deviceName),
            }),
        );
        window.dispatchEvent(new Event(SETUP_INTENT_EVENT));
        dismiss();
        void push("/settings/passkeys");
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (!$passkeyUpgradePrompt) return;
        if (event.key === "Escape") {
            dismiss();
            return;
        }
        if (
            event.key !== "Tab" ||
            !closeButtonElement ||
            !primaryButtonElement
        ) {
            return;
        }
        if (event.shiftKey && document.activeElement === closeButtonElement) {
            event.preventDefault();
            primaryButtonElement.focus();
        } else if (
            !event.shiftKey &&
            document.activeElement === primaryButtonElement
        ) {
            event.preventDefault();
            closeButtonElement.focus();
        }
    }

    function deviceLabelForPrompt(deviceName: string): string {
        const normalized = deviceName.trim().toLowerCase();
        if (normalized.startsWith("mac")) return "this Mac";
        if (normalized.startsWith("win")) return "this Windows PC";
        if (normalized.includes("linux")) return "this Linux computer";
        return deviceName.trim() || "this device";
    }

    function passkeyNameForDevice(deviceName: string): string {
        const normalized = deviceName.trim().toLowerCase();
        if (normalized.startsWith("mac")) return "Mac";
        if (normalized.startsWith("win")) return "Windows PC";
        if (normalized.includes("linux")) return "Linux computer";
        return deviceName.trim() || "This device";
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $passkeyUpgradePrompt}
    {@const fromAnotherAuthenticator =
        $passkeyUpgradePrompt.reason === "cross_platform_passkey"}
    <div class="passkey-prompt">
        <button
            class="passkey-prompt__backdrop"
            type="button"
            aria-label="Dismiss passkey suggestion"
            onclick={dismiss}
        ></button>
        <div
            class="passkey-prompt__dialog"
            role="dialog"
            aria-labelledby="passkey-prompt-title"
            aria-modal="true"
        >
            <button
                bind:this={closeButtonElement}
                class="passkey-prompt__close"
                type="button"
                aria-label="Not now"
                title="Not now"
                onclick={dismiss}
            >
                <X size={18} />
            </button>
            <span class="passkey-prompt__icon"><KeyRound size={24} /></span>
            <div class="passkey-prompt__copy">
                <span class="passkey-prompt__eyebrow">Faster sign-in</span>
                <h2 id="passkey-prompt-title">
                    {fromAnotherAuthenticator
                        ? "Add a passkey to this device"
                        : "Skip your password next time"}
                </h2>
                <p>
                    {fromAnotherAuthenticator
                        ? `You signed in with a passkey from another device or security key. Add one to ${deviceLabelForPrompt($passkeyUpgradePrompt.deviceName)} for faster access next time.`
                        : `Create a passkey for ${deviceLabelForPrompt($passkeyUpgradePrompt.deviceName)}. Sign in with your fingerprint, face, or device PIN while keeping your password as a backup.`}
                </p>
            </div>
            <div class="passkey-prompt__actions">
                <button
                    class="passkey-prompt__button passkey-prompt__button--secondary"
                    type="button"
                    onclick={dismiss}
                >
                    Not now
                </button>
                <button
                    bind:this={primaryButtonElement}
                    class="passkey-prompt__button passkey-prompt__button--primary"
                    type="button"
                    use:focusOnMount
                    onclick={startSetup}
                >
                    <KeyRound size={17} />
                    Create passkey
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .passkey-prompt {
        position: fixed;
        z-index: 500;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
    }

    .passkey-prompt__backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: rgba(0, 0, 0, 0.72);
        cursor: default;
    }

    .passkey-prompt__dialog {
        position: relative;
        width: min(430px, 100%);
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 24px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--bg-elevated);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48);
    }

    .passkey-prompt__close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 6px;
        color: var(--text-muted);
        background: transparent;
    }

    .passkey-prompt__close:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .passkey-prompt__icon {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        color: var(--text-secondary);
        background: var(--bg-hover);
    }

    .passkey-prompt__copy {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-right: 24px;
    }

    .passkey-prompt__eyebrow {
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .passkey-prompt__copy h2 {
        margin: 0;
        color: var(--text-primary);
        font-size: 24px;
        line-height: 1.2;
    }

    .passkey-prompt__copy p {
        margin: 0;
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1.5;
    }

    .passkey-prompt__actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }

    .passkey-prompt__button {
        min-height: 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 15px;
        border: 1px solid transparent;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 650;
    }

    .passkey-prompt__button--secondary {
        border-color: var(--border-strong);
        color: var(--text-secondary);
        background: transparent;
    }

    .passkey-prompt__button--secondary:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .passkey-prompt__button--primary {
        border-color: var(--accent);
        color: var(--on-accent);
        background: var(--accent);
    }

    .passkey-prompt__button--primary:hover {
        filter: brightness(1.08);
    }
</style>
