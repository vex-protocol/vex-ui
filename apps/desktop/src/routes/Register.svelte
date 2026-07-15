<script lang="ts">
    import { push } from "svelte-spa-router";

    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError, playUnlock } from "../lib/sounds.js";
    import { user as userAtom, vexService } from "../lib/store/index.js";

    let username = $state("");
    let password = $state("");
    let confirmPassword = $state("");
    let errors: Record<string, string> = $state({});
    let loading = $state(false);
    let showPassword = $state(false);

    const USERNAME_RE = /^[a-z0-9_]{3,19}$/;

    function validateUsername(value: string): null | string {
        if (!USERNAME_RE.test(value)) {
            return "Use 3-19 letters, numbers, or underscores";
        }
        return null;
    }

    async function handleRegister(e: SubmitEvent) {
        e.preventDefault();
        errors = {};

        // Usernames are case-insensitive at the protocol level —
        // the server canonicalizes to lowercase, so do the same here
        // before validation and before sending so what the user sees
        // in errors / future logins matches what's persisted.
        const normalizedUsername = username.trim().toLowerCase();
        const usernameError = validateUsername(normalizedUsername);
        if (usernameError) {
            errors = { username: usernameError };
            return;
        }
        if (password.length < 15) {
            errors = { password: "Use at least 15 characters" };
            return;
        }
        if (password.length > 1024) {
            errors = { password: "Password is too long" };
            return;
        }
        if (password !== confirmPassword) {
            errors = { confirmPassword: "Passwords do not match" };
            return;
        }

        loading = true;

        const result = await vexService.register(
            normalizedUsername,
            password,
            desktopConfig(),
            getServerOptions(),
            keyStore,
        );

        if (!result.ok) {
            errors = { form: result.error ?? "Registration failed" };
            playError();
            loading = false;
            return;
        }

        if (userAtom.get()) {
            playUnlock();
            void push("/home");
        } else {
            errors = {
                form: "Registration succeeded but could not connect to server",
            };
            playError();
            loading = false;
        }
    }
</script>

<div class="auth-page">
    <div class="auth-card">
        <h1 class="auth-card__title">Create account</h1>
        <p class="auth-card__subtitle">Choose a username and password</p>

        {#if errors.form}
            <p class="auth-card__error">{errors.form}</p>
        {/if}

        <form class="auth-form" onsubmit={handleRegister}>
            <div class="auth-form__field">
                <label for="username">Username</label>
                <input
                    id="username"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    placeholder="pick a username"
                    spellcheck="false"
                    bind:value={username}
                    disabled={loading}
                    required
                />
                {#if errors.username}<span class="field-error"
                        >{errors.username}</span
                    >{/if}
            </div>

            <div class="auth-form__field">
                <label for="password">Password</label>
                <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="choose a password"
                    minlength={15}
                    maxlength={1024}
                    bind:value={password}
                    disabled={loading}
                    required
                />
                {#if errors.password}<span class="field-error"
                        >{errors.password}</span
                    >{/if}
            </div>

            <div class="auth-form__field">
                <label for="confirm-password">Confirm password</label>
                <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="enter it again"
                    minlength={15}
                    maxlength={1024}
                    bind:value={confirmPassword}
                    disabled={loading}
                    required
                />
                {#if errors.confirmPassword}<span class="field-error"
                        >{errors.confirmPassword}</span
                    >{/if}
            </div>

            <label class="auth-form__check">
                <input type="checkbox" bind:checked={showPassword} />
                <span>Show password</span>
            </label>

            <button class="auth-form__submit" type="submit" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
            </button>
        </form>

        <p class="auth-card__footer">
            Already have an account?
            <button class="auth-card__link" onclick={() => push("/login")}
                >Sign in</button
            >
        </p>
    </div>
</div>

<style>
    .auth-page {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
    }
    .auth-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 32px;
        width: min(360px, calc(100vw - 32px));
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .auth-card__title {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
    }
    .auth-card__subtitle {
        font-size: 13px;
        color: var(--text-secondary);
        margin-top: -10px;
    }
    .auth-card__error {
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        color: var(--danger);
        border: 1px solid var(--danger);
        border-radius: 4px;
        padding: 8px 12px;
        font-size: 13px;
    }
    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .auth-form__field {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .auth-form__field label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0;
    }
    .auth-form__submit {
        background: var(--accent);
        color: #fff;
        padding: 10px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
        transition: opacity 0.15s;
        margin-top: 4px;
    }
    .auth-form__submit:hover:not(:disabled) {
        opacity: 0.9;
    }
    .auth-form__submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
        flex: 0 0 auto;
        height: 16px;
        margin: 0;
        width: 16px;
    }
    .auth-card__footer {
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
    }
    .auth-card__link {
        color: var(--accent);
        text-decoration: underline;
        font-size: 13px;
    }
    .field-error {
        color: var(--danger);
        font-size: 12px;
    }
</style>
