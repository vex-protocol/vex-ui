<script lang="ts">
    import { push } from "svelte-spa-router";

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
        const passkey = await vexService.authenticateAccountWithPasskey(
            normalizedUsername,
            desktopConfig(),
            getServerOptions(),
            keyStore,
        );
        if (!passkey.ok) {
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
    <div class="auth-card">
        <h1 class="auth-card__title">Welcome back</h1>
        <p class="auth-card__subtitle">Sign in with your password</p>

        {#if error}
            <p class="auth-card__error">{error}</p>
        {/if}
        {#if notice}
            <p class="auth-card__notice" role="status">{notice}</p>
        {/if}

        <form class="auth-form" onsubmit={handleLogin}>
            <div class="auth-form__field">
                <label for="username">Username</label>
                <input
                    id="username"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    placeholder="your username"
                    spellcheck="false"
                    bind:value={username}
                    disabled={loading || awaitingApproval}
                    required
                />
            </div>

            <div class="auth-form__field">
                <label for="password">Password</label>
                <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autocomplete="current-password"
                    placeholder="your password"
                    minlength={1}
                    maxlength={1024}
                    bind:value={password}
                    disabled={loading || awaitingApproval}
                    required
                />
            </div>

            <label class="auth-form__check">
                <input
                    type="checkbox"
                    bind:checked={showPassword}
                    disabled={loading || awaitingApproval}
                />
                <span>Show password</span>
            </label>

            <button
                class="auth-form__submit"
                type="submit"
                disabled={loading || awaitingApproval}
            >
                {loading && authMethod === "password"
                    ? "Signing in..."
                    : "Sign in"}
            </button>
            <button
                class="auth-form__secondary"
                type="button"
                onclick={handlePasskeyLogin}
                disabled={loading || awaitingApproval || !username.trim()}
            >
                {loading && authMethod === "passkey"
                    ? "Verifying passkey..."
                    : "Use a passkey"}
            </button>
            {#if awaitingApproval}
                <button
                    class="auth-form__secondary"
                    type="button"
                    onclick={cancelApproval}
                >
                    Cancel request
                </button>
            {/if}
        </form>

        <button class="auth-card__link" onclick={() => push("/recover")}
            >Forgot password?</button
        >

        <p class="auth-card__footer">
            Don't have an account?
            <button class="auth-card__link" onclick={() => push("/register")}
                >Register</button
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
    .auth-card__notice {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        border: 1px solid var(--accent);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 13px;
        line-height: 1.4;
        padding: 10px 12px;
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
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
        padding: 10px;
    }
    .auth-form__secondary:hover {
        background: var(--bg-hover);
    }
    .auth-card__footer {
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
    }
    .auth-card__link {
        align-self: center;
        color: var(--accent);
        text-decoration: underline;
        font-size: 13px;
    }
</style>
