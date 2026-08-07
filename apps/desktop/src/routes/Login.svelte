<script lang="ts">
    import { push } from "svelte-spa-router";

    import {
        ArrowRight,
        KeyRound,
        LoaderCircle,
        ShieldCheck,
        X,
    } from "@lucide/svelte";

    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import { desktopConfig } from "../lib/platform.js";
    import { playError, playUnlock } from "../lib/sounds.js";
    import {
        channels as channelsAtom,
        servers as serversAtom,
        user as userAtom,
        vexService,
    } from "../lib/store/index.js";
    import VexLogo from "../lib/VexLogo.svelte";

    let username = $state("");
    let password = $state("");
    let error = $state("");
    let notice = $state("");
    let loading = $state(false);
    let authMethod: "passkey" | "password" | null = $state(null);
    let awaitingApproval = $state(false);
    let showPassword = $state(false);

    const USERNAME_RE = /^[a-z0-9_]{3,19}$/;

    if (sessionStorage.getItem("vex-password-reset") === "complete") {
        sessionStorage.removeItem("vex-password-reset");
        notice = "Password updated. Sign in with your new password.";
    }

    $effect(() => {
        if (awaitingApproval && $userAtom) {
            playUnlock();
            void push("/home");
        }
    });

    async function handleLogin(e: SubmitEvent) {
        e.preventDefault();
        loading = true;
        authMethod = "password";
        error = "";
        notice = "";

        const normalizedUsername = username.trim().toLowerCase();
        if (!USERNAME_RE.test(normalizedUsername)) {
            error = "Use a valid username and password.";
            loading = false;
            authMethod = null;
            return;
        }
        if (password.length === 0 || password.length > 1024) {
            error = "Use a valid username and password.";
            loading = false;
            authMethod = null;
            return;
        }

        const savedCredentials = await keyStore.load(normalizedUsername);
        const result = savedCredentials
            ? await vexService.login(
                  normalizedUsername,
                  password,
                  desktopConfig(),
                  getServerOptions(),
                  keyStore,
              )
            : await vexService.requestDeviceEnrollment(
                  normalizedUsername,
                  password,
                  desktopConfig(),
                  getServerOptions(),
                  keyStore,
              );

        if (!result.ok) {
            if (result.pendingDeviceApproval && result.pendingRequestID) {
                if (!savedCredentials) {
                    const published =
                        await vexService.publishDeferredDeviceApprovalAndStartWatching(
                            keyStore,
                        );
                    if (!published.ok) {
                        error =
                            published.error ??
                            "Could not notify your signed-in devices.";
                        playError();
                        loading = false;
                        authMethod = null;
                        return;
                    }
                }
                awaitingApproval = true;
                notice =
                    "Approval requested. Keep Vex open and approve this device from a signed-in device.";
                loading = false;
                authMethod = null;
                return;
            }
            error = result.error ?? "Login failed";
            playError();
            loading = false;
            authMethod = null;
            return;
        }

        if (userAtom.get()) {
            playUnlock();
            navigateAfterAuthentication();
        } else {
            error = "Could not verify credentials after login";
            playError();
            loading = false;
            authMethod = null;
        }
    }

    async function handlePasskeyLogin(): Promise<void> {
        const normalizedUsername = username.trim().toLowerCase();
        error = "";
        notice = "";
        if (!USERNAME_RE.test(normalizedUsername)) {
            error = "Enter your username before using a passkey.";
            return;
        }

        loading = true;
        authMethod = "passkey";
        if ("__TAURI_INTERNALS__" in window) {
            notice = "Continue with your passkey in the browser window.";
        }
        const passkey = await vexService.authenticateAccountWithPasskey(
            normalizedUsername,
            desktopConfig(),
            getServerOptions(),
            keyStore,
        );
        if (!passkey.ok) {
            notice = "";
            error = passkey.error ?? "Could not verify this passkey.";
            playError();
            loading = false;
            authMethod = null;
            return;
        }

        const local =
            await vexService.finishPasskeyAuthenticatedDeviceSignIn(keyStore);
        if (local.ok) {
            playUnlock();
            navigateAfterAuthentication();
            return;
        }
        if (!local.needsDeviceApproval) {
            error = local.error ?? "This device could not finish signing in.";
            playError();
            loading = false;
            authMethod = null;
            return;
        }

        const approval =
            await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                desktopConfig(),
                getServerOptions(),
                keyStore,
            );
        if (
            !approval.ok &&
            approval.pendingDeviceApproval &&
            approval.pendingRequestID
        ) {
            awaitingApproval = true;
            notice =
                "Passkey verified. Approve this device from another signed-in device.";
            loading = false;
            authMethod = null;
            return;
        }
        if (approval.ok) {
            playUnlock();
            navigateAfterAuthentication();
            return;
        }

        error = approval.error ?? "Could not request approval for this device.";
        playError();
        loading = false;
        authMethod = null;
    }

    function navigateAfterAuthentication(): void {
        const serverList = Object.values(serversAtom.get());
        const firstServer = serverList[0];
        if (firstServer) {
            const sid = firstServer.serverID;
            const chs = channelsAtom.get()[sid] ?? [];
            const firstChannel = chs[0];
            if (firstChannel) {
                void push(`/server/${sid}/${firstChannel.channelID}`);
                return;
            }
        }
        void push("/home");
    }

    function cancelApproval(): void {
        vexService.cancelPendingApproval();
        awaitingApproval = false;
        notice = "";
        authMethod = null;
    }
</script>

<div class="auth-page">
    <main class="auth-card">
        <VexLogo size={39} />

        {#if awaitingApproval}
            <section class="approval" aria-live="polite">
                <span class="approval__icon"><ShieldCheck size={26} /></span>
                <div>
                    <span class="auth-card__eyebrow">Device verification</span>
                    <h1 class="auth-card__title">Approve this Mac</h1>
                    <p class="auth-card__subtitle">
                        Open Vex on a signed-in device and approve this request.
                    </p>
                </div>
                {#if notice}
                    <p class="auth-card__notice" role="status">{notice}</p>
                {/if}
                <button
                    class="auth-button auth-button--secondary"
                    type="button"
                    onclick={cancelApproval}
                >
                    <X size={17} />
                    Cancel request
                </button>
            </section>
        {:else}
            <header class="auth-card__header">
                <span class="auth-card__eyebrow">Secure messaging</span>
                <h1 class="auth-card__title">Welcome back</h1>
                <p class="auth-card__subtitle">
                    Sign in with your username and password.
                </p>
            </header>

            {#if error}
                <p class="auth-card__error" role="alert">{error}</p>
            {/if}
            {#if notice}
                <p class="auth-card__notice" role="status">{notice}</p>
            {/if}

            <form class="auth-form" onsubmit={handleLogin}>
                <label class="auth-form__field" for="username">
                    <span>Username</span>
                    <input
                        id="username"
                        type="text"
                        autocomplete="username"
                        autocapitalize="none"
                        placeholder="your username"
                        spellcheck="false"
                        bind:value={username}
                        disabled={loading}
                        required
                    />
                </label>

                <label class="auth-form__field" for="password">
                    <span>Password</span>
                    <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autocomplete="current-password"
                        placeholder="your password"
                        minlength={1}
                        maxlength={1024}
                        bind:value={password}
                        disabled={loading}
                        required
                    />
                </label>

                <div class="auth-form__options">
                    <label class="auth-form__check">
                        <input
                            type="checkbox"
                            bind:checked={showPassword}
                            disabled={loading}
                        />
                        <span>Show password</span>
                    </label>
                    <button
                        class="auth-card__link"
                        type="button"
                        onclick={() => push("/recover")}
                        >Forgot password?</button
                    >
                </div>

                <button
                    class="auth-button auth-button--primary"
                    type="submit"
                    disabled={loading}
                >
                    {#if loading && authMethod === "password"}
                        <LoaderCircle class="spin" size={17} />
                        Signing in...
                    {:else}
                        Sign in
                        <ArrowRight size={17} />
                    {/if}
                </button>
                <button
                    class="auth-button auth-button--secondary"
                    type="button"
                    onclick={handlePasskeyLogin}
                    disabled={loading || !username.trim()}
                >
                    {#if loading && authMethod === "passkey"}
                        <LoaderCircle class="spin" size={17} />
                        Verifying passkey...
                    {:else}
                        <KeyRound size={17} />
                        Use a passkey
                    {/if}
                </button>
            </form>

            <p class="auth-card__footer">
                New to Vex?
                <button
                    class="auth-card__link"
                    type="button"
                    onclick={() => push("/register")}>Create account</button
                >
            </p>
        {/if}
    </main>
</div>

<style>
    .auth-page {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow-y: auto;
        padding: 48px 24px;
        background:
            radial-gradient(
                720px 480px at 50% -12%,
                color-mix(in srgb, var(--accent) 9%, transparent),
                transparent 68%
            ),
            repeating-linear-gradient(
                0deg,
                transparent 0 39px,
                color-mix(in srgb, var(--text-primary) 3.5%, transparent) 39px
                    40px
            ),
            repeating-linear-gradient(
                90deg,
                transparent 0 39px,
                color-mix(in srgb, var(--text-primary) 3.5%, transparent) 39px
                    40px
            ),
            var(--bg-tertiary);
        animation: vex-fade 240ms var(--ease-out);
    }

    .auth-card {
        width: min(420px, 100%);
        display: flex;
        flex-direction: column;
        gap: 22px;
        padding: 34px 32px 30px;
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: var(--bg-secondary);
        box-shadow: var(--shadow-pop);
        animation: vex-pop 260ms var(--ease-out);
    }

    .auth-card__header,
    .approval > div {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }

    .auth-card__header {
        padding-top: 4px;
    }

    .auth-card__eyebrow {
        color: var(--accent-text);
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.13em;
        text-transform: uppercase;
    }

    .auth-card__title {
        color: var(--text-primary);
        font-family: var(--font-heading);
        font-size: 29px;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
    }

    .auth-card__subtitle {
        color: var(--text-muted);
        font-size: 13.5px;
        line-height: 1.55;
    }

    .auth-card__error,
    .auth-card__notice {
        padding: 10px 13px;
        border: 1px solid;
        border-radius: var(--radius-md);
        font-size: 13px;
        line-height: 1.45;
    }

    .auth-card__error {
        border-color: color-mix(in srgb, var(--danger) 46%, transparent);
        background: color-mix(in srgb, var(--danger) 11%, transparent);
        color: #ffb4b2;
    }

    .auth-card__notice {
        border-color: color-mix(in srgb, var(--success) 42%, transparent);
        background: color-mix(in srgb, var(--success) 10%, transparent);
        color: #6ee7c5;
    }

    .auth-form,
    .auth-form__field {
        display: flex;
        flex-direction: column;
    }

    .auth-form {
        gap: 15px;
    }

    .auth-form__field {
        gap: 7px;
    }

    .auth-form__field > span {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .auth-form__field input {
        height: 46px;
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        padding: 0 13px;
    }

    .auth-form__options {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin: -2px 0 3px;
    }

    .auth-form__check {
        width: fit-content;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 12.5px;
    }

    .auth-form__check input {
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        margin: 0;
        accent-color: var(--accent);
    }

    .auth-button {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        font-size: 13.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
        transition:
            background-color 140ms var(--ease-out),
            border-color 140ms var(--ease-out),
            box-shadow 140ms var(--ease-out),
            color 140ms var(--ease-out),
            transform 100ms var(--ease-out);
    }

    .auth-button--primary {
        background: var(--accent);
        color: var(--on-accent);
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            0 10px 24px -10px color-mix(in srgb, var(--accent) 60%, transparent);
    }

    .auth-button--primary:hover:not(:disabled) {
        background: var(--accent-hover);
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.18),
            0 12px 28px -10px color-mix(in srgb, var(--accent) 70%, transparent);
    }

    .auth-button--primary:active:not(:disabled) {
        transform: translateY(1px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    .auth-button--secondary {
        border-color: var(--border-strong);
        background: var(--bg-surface);
        color: var(--text-secondary);
    }

    .auth-button--secondary:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .auth-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }

    .auth-card__footer {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
    }

    .auth-card__link {
        color: var(--accent-text);
        font-size: inherit;
        font-weight: 600;
    }

    .auth-card__link:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .approval {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding-top: 4px;
    }

    .approval__icon {
        width: 52px;
        height: 52px;
        display: grid;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
        border-radius: var(--radius-lg);
        background: color-mix(in srgb, var(--success) 12%, transparent);
        color: var(--success);
    }

    :global(.spin) {
        animation: spin 900ms linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
