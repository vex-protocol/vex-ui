<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ArrowRight, LoaderCircle } from "@lucide/svelte";

    import "../auth.css";
    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError, playUnlock } from "../lib/sounds.js";
    import { user as userAtom, vexService } from "../lib/store/index.js";
    import VexLogo from "../lib/VexLogo.svelte";

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
    <main class="auth-card">
        <VexLogo size={39} />
        <header class="auth-card__header">
            <span class="auth-card__eyebrow">New account</span>
            <h1 class="auth-card__title">Create your account</h1>
            <p class="auth-card__subtitle">
                Start with a password. Add passkeys from Settings later.
            </p>
        </header>

        {#if errors.form}
            <p class="auth-card__error" role="alert">{errors.form}</p>
        {/if}

        <form class="auth-form" onsubmit={handleRegister}>
            <label class="auth-form__field" for="register-username">
                <span>Username</span>
                <input
                    id="register-username"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    placeholder="pick a username"
                    spellcheck="false"
                    bind:value={username}
                    disabled={loading}
                    required
                />
                {#if errors.username}
                    <span class="field-error">{errors.username}</span>
                {/if}
            </label>

            <label class="auth-form__field" for="register-password">
                <span>Password</span>
                <input
                    id="register-password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="15 characters or more"
                    minlength={15}
                    maxlength={1024}
                    bind:value={password}
                    disabled={loading}
                    required
                />
                {#if errors.password}
                    <span class="field-error">{errors.password}</span>
                {/if}
            </label>

            <label class="auth-form__field" for="confirm-password">
                <span>Confirm password</span>
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
                {#if errors.confirmPassword}
                    <span class="field-error">{errors.confirmPassword}</span>
                {/if}
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
                    Creating account...
                {:else}
                    Create account
                    <ArrowRight size={17} />
                {/if}
            </button>
        </form>

        <p class="auth-card__footer">
            Already have an account?
            <button
                class="auth-card__link"
                type="button"
                onclick={() => push("/login")}>Sign in</button
            >
        </p>
    </main>
</div>
