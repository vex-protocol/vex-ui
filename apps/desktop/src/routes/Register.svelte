<script lang="ts">
    import { push } from "svelte-spa-router";

    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError, playUnlock } from "../lib/sounds.js";
    import { user as userAtom, vexService } from "../lib/store/index.js";

    let username = $state("");
    let errors: Record<string, string> = $state({});
    let loading = $state(false);
    let needsPasskeyRetry = $state(false);

    const USERNAME_RE = /^[a-z0-9_-]+$/i;
    const LEADING_TRAILING_RE = /^[-_]|[-_]$/;

    function validateUsername(value: string): null | string {
        if (value.length < 3) return "Username must be at least 3 characters";
        if (!USERNAME_RE.test(value))
            return "Username can only contain letters, numbers, hyphens, and underscores";
        if (LEADING_TRAILING_RE.test(value))
            return "Username cannot start or end with a hyphen or underscore";
        return null;
    }

    async function handleRegister(e: SubmitEvent) {
        e.preventDefault();
        errors = {};
        needsPasskeyRetry = false;

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

        loading = true;

        const result = await vexService.register(
            normalizedUsername,
            "",
            desktopConfig(),
            getServerOptions(),
            keyStore,
        );

        if (!result.ok) {
            if (result.pendingDeviceApproval) {
                const published =
                    await vexService.publishDeferredDeviceApprovalAndStartWatching(
                        keyStore,
                    );
                if (!published.ok) {
                    errors = {
                        form:
                            published.error ??
                            result.error ??
                            "Could not start device approval.",
                    };
                    playError();
                    loading = false;
                    return;
                }
                errors = {
                    form:
                        result.error ??
                        "Check your other signed-in device to approve this one.",
                };
                playError();
                loading = false;
                return;
            }
            if (result.passkeySetupRequired) {
                errors = {
                    form:
                        result.error ??
                        "Passkey setup did not finish. Retry to complete account setup.",
                };
                needsPasskeyRetry = true;
                playError();
                loading = false;
                return;
            }
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

    async function handlePasskeyRetry(): Promise<void> {
        errors = {};
        loading = true;
        const result =
            await vexService.completeInitialPasskeySetup(desktopConfig());
        if (result.ok && userAtom.get()) {
            playUnlock();
            void push("/home");
            return;
        }
        errors = {
            form:
                result.error ??
                "Passkey setup did not finish. Retry to complete account setup.",
        };
        needsPasskeyRetry = result.passkeySetupRequired === true;
        playError();
        loading = false;
    }
</script>

<div class="auth-page">
    <div class="auth-card">
        <h1 class="auth-card__title">Create account</h1>
        <p class="auth-card__subtitle">Join Vex Chat</p>

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
                    placeholder="pick a username"
                    bind:value={username}
                    disabled={loading}
                    required
                />
                {#if errors.username}<span class="field-error"
                        >{errors.username}</span
                    >{/if}
            </div>

            <button class="auth-form__submit" type="submit" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
            </button>
            {#if needsPasskeyRetry}
                <button
                    class="auth-form__secondary"
                    type="button"
                    disabled={loading}
                    onclick={() => void handlePasskeyRetry()}
                >
                    Finish passkey setup
                </button>
            {/if}
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
        width: 360px;
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
        letter-spacing: 0.04em;
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
    .auth-form__secondary {
        border: 1px solid var(--border);
        background: var(--bg-surface);
        color: var(--text-primary);
        padding: 10px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
    }
    .auth-form__secondary:hover:not(:disabled) {
        background: var(--bg-hover);
    }
    .auth-form__secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
