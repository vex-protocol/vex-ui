<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ArrowLeft, KeyRound, LoaderCircle } from "@lucide/svelte";

    import "../auth.css";
    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError } from "../lib/sounds.js";
    import { vexService } from "../lib/store/index.js";
    import VexLogo from "../lib/VexLogo.svelte";

    const USERNAME_RE = /^[a-z0-9_]{3,19}$/;

    let username = $state("");
    let newPassword = $state("");
    let confirmPassword = $state("");
    let showPassword = $state(false);
    let loading = $state(false);
    let error = $state("");

    async function handleReset(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        error = "";
        const normalizedUsername = username.trim().toLowerCase();
        if (!USERNAME_RE.test(normalizedUsername)) {
            error = "Enter a valid username.";
            return;
        }
        if (newPassword.length < 15) {
            error = "Use at least 15 characters for the new password.";
            return;
        }
        if (newPassword.length > 1024) {
            error = "The new password is too long.";
            return;
        }
        if (newPassword !== confirmPassword) {
            error = "Passwords do not match.";
            return;
        }

        loading = true;
        const authentication = await vexService.authenticateAccountWithPasskey(
            normalizedUsername,
            desktopConfig(),
            getServerOptions(),
            keyStore,
        );
        if (!authentication.ok) {
            error =
                authentication.error ?? "Could not verify an account passkey.";
            playError();
            loading = false;
            return;
        }

        const reset = await vexService.resetPasswordWithPasskey(newPassword);
        if (!reset.ok) {
            error = reset.error ?? "Could not reset the password.";
            playError();
            loading = false;
            return;
        }

        await vexService.logout();
        sessionStorage.setItem("vex-password-reset", "complete");
        void push("/login");
    }
</script>

<div class="auth-page">
    <main class="auth-card">
        <VexLogo size={39} />
        <button
            class="auth-card__back"
            type="button"
            onclick={() => push("/login")}
        >
            <ArrowLeft size={15} />
            Back to sign in
        </button>
        <header class="auth-card__header">
            <span class="auth-card__eyebrow">Account recovery</span>
            <h1 class="auth-card__title">Reset your password</h1>
            <p class="auth-card__subtitle">
                An existing account passkey will verify this change.
            </p>
        </header>

        {#if error}
            <p class="auth-card__error" role="alert">{error}</p>
        {/if}

        <form class="auth-form" onsubmit={handleReset}>
            <label class="auth-form__field" for="recover-username">
                <span>Username</span>
                <input
                    id="recover-username"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    placeholder="your username"
                    bind:value={username}
                    disabled={loading}
                    required
                />
            </label>
            <label class="auth-form__field" for="recover-password">
                <span>New password</span>
                <input
                    id="recover-password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="15 characters or more"
                    minlength={15}
                    maxlength={1024}
                    bind:value={newPassword}
                    disabled={loading}
                    required
                />
            </label>
            <label class="auth-form__field" for="recover-confirm">
                <span>Confirm new password</span>
                <input
                    id="recover-confirm"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="enter it again"
                    minlength={15}
                    maxlength={1024}
                    bind:value={confirmPassword}
                    disabled={loading}
                    required
                />
            </label>
            <label class="auth-form__check">
                <input
                    type="checkbox"
                    bind:checked={showPassword}
                    disabled={loading}
                />
                <span>Show passwords</span>
            </label>
            <button
                class="auth-button auth-button--primary"
                type="submit"
                disabled={loading}
            >
                {#if loading}
                    <LoaderCircle class="spin" size={17} />
                    Verifying passkey...
                {:else}
                    <KeyRound size={17} />
                    Verify and reset
                {/if}
            </button>
        </form>
    </main>
</div>
