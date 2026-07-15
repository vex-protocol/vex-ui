<script lang="ts">
    import { push } from "svelte-spa-router";

    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError } from "../lib/sounds.js";
    import { vexService } from "../lib/store/index.js";

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
    <div class="auth-card">
        <button class="auth-card__back" onclick={() => push("/login")}
            >← Back to sign in</button
        >
        <h1 class="auth-card__title">Reset password</h1>
        <p class="auth-card__subtitle">Verify with an account passkey</p>

        {#if error}
            <p class="auth-card__error" role="alert">{error}</p>
        {/if}

        <form class="auth-form" onsubmit={handleReset}>
            <div class="auth-form__field">
                <label for="recover-username">Username</label>
                <input
                    id="recover-username"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    bind:value={username}
                    disabled={loading}
                    required
                />
            </div>
            <div class="auth-form__field">
                <label for="recover-password">New password</label>
                <input
                    id="recover-password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    minlength={15}
                    maxlength={1024}
                    bind:value={newPassword}
                    disabled={loading}
                    required
                />
                <span class="auth-form__hint">15 characters minimum</span>
            </div>
            <div class="auth-form__field">
                <label for="recover-confirm">Confirm new password</label>
                <input
                    id="recover-confirm"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    minlength={15}
                    maxlength={1024}
                    bind:value={confirmPassword}
                    disabled={loading}
                    required
                />
            </div>
            <label class="auth-form__check">
                <input type="checkbox" bind:checked={showPassword} />
                <span>Show password</span>
            </label>
            <button class="auth-form__submit" type="submit" disabled={loading}>
                {loading ? "Verifying passkey..." : "Verify and reset"}
            </button>
        </form>
    </div>
</div>

<style>
    .auth-page {
        align-items: center;
        background: var(--bg-primary);
        display: flex;
        flex: 1;
        justify-content: center;
    }

    .auth-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 32px;
        width: min(360px, calc(100vw - 32px));
    }

    .auth-card__back {
        align-self: flex-start;
        color: var(--text-secondary);
        font-size: 13px;
    }

    .auth-card__back:hover {
        color: var(--text-primary);
    }

    .auth-card__title {
        color: var(--text-primary);
        font-size: 22px;
        font-weight: 700;
    }

    .auth-card__subtitle {
        color: var(--text-secondary);
        font-size: 13px;
        margin-top: -10px;
    }

    .auth-card__error {
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        border: 1px solid var(--danger);
        border-radius: 4px;
        color: var(--danger);
        font-size: 13px;
        padding: 8px 12px;
    }

    .auth-form,
    .auth-form__field {
        display: flex;
        flex-direction: column;
    }

    .auth-form {
        gap: 14px;
    }

    .auth-form__field {
        gap: 5px;
    }

    .auth-form__field label {
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0;
        text-transform: uppercase;
    }

    .auth-form__hint {
        color: var(--text-muted);
        font-size: 11px;
    }

    .auth-form__check {
        align-items: center;
        color: var(--text-secondary);
        display: flex;
        font-size: 13px;
        gap: 8px;
        width: fit-content;
    }

    .auth-form__check input {
        accent-color: var(--accent);
    }

    .auth-form__submit {
        background: var(--accent);
        border-radius: 4px;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        padding: 10px;
    }

    .auth-form__submit:disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
</style>
