import type { BrowserAccount } from "../lib/browserVault";
import type { WebRoute } from "../lib/router";
import type { ComponentChildren } from "preact";

import {
    $channels,
    $pendingApprovalStage,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";

import {
    ArrowLeft,
    ArrowRight,
    Check,
    Eye,
    EyeOff,
    KeyRound,
    LoaderCircle,
    ShieldCheck,
    UserRound,
    X,
} from "lucide-preact";
import { useEffect, useState } from "preact/hooks";

import { VexMark } from "../components/VexMark";
import {
    browserKeyStore,
    getServerOptions,
    webBootstrapConfig,
} from "../lib/config";
import { consumePostAuthPath } from "../lib/postAuthRoute";
import { navigate } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";

const USERNAME_RE = /^[a-z0-9_]{3,19}$/u;

interface AuthViewProps {
    route: Extract<WebRoute, { kind: "login" | "recover" | "register" }>;
}

export function AuthView({ route }: AuthViewProps) {
    const user = useStoreValue($user);
    const pendingStage = useStoreValue($pendingApprovalStage);
    const [accounts, setAccounts] = useState<BrowserAccount[]>([]);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState(() => {
        if (sessionStorage.getItem("vex-password-reset") !== "complete") {
            return "";
        }
        sessionStorage.removeItem("vex-password-reset");
        return "Password updated. Sign in with your new password.";
    });
    const [loading, setLoading] = useState(false);
    const [method, setMethod] = useState<"passkey" | "password" | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [awaitingApproval, setAwaitingApproval] = useState(false);

    useEffect(() => {
        let active = true;
        void browserKeyStore.listAccounts().then((next) => {
            if (active) setAccounts(next);
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (awaitingApproval && user) navigateAfterAuthentication();
    }, [awaitingApproval, user]);

    const resetFeedback = () => {
        setError("");
        setNotice("");
    };

    async function signIn(event: SubmitEvent) {
        event.preventDefault();
        const normalized = username.trim().toLowerCase();
        resetFeedback();
        if (!USERNAME_RE.test(normalized) || password.length === 0) {
            setError("Use a valid username and password.");
            return;
        }
        setLoading(true);
        setMethod("password");
        try {
            const saved = await browserKeyStore.load(normalized);
            const result = saved
                ? await vexService.login(
                      normalized,
                      password,
                      webBootstrapConfig(),
                      getServerOptions(),
                      browserKeyStore,
                  )
                : await vexService.requestDeviceEnrollment(
                      normalized,
                      password,
                      webBootstrapConfig(),
                      getServerOptions(),
                      browserKeyStore,
                  );
            if (!result.ok) {
                if (result.pendingDeviceApproval && result.pendingRequestID) {
                    if (!saved) {
                        const published =
                            await vexService.publishDeferredDeviceApprovalAndStartWatching(
                                browserKeyStore,
                            );
                        if (!published.ok) {
                            setError(
                                published.error ??
                                    "Could not notify your signed-in devices.",
                            );
                            return;
                        }
                    }
                    setAwaitingApproval(true);
                    setNotice(
                        "Approval requested. Keep this tab open and approve it from a signed-in device.",
                    );
                    return;
                }
                setError(result.error ?? "Sign in failed.");
                return;
            }
            if (!$user.get()) {
                setError("Could not verify the account after sign in.");
                return;
            }
            navigateAfterAuthentication();
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Sign in failed."));
        } finally {
            setLoading(false);
            setMethod(null);
        }
    }

    async function signInWithPasskey() {
        const normalized = username.trim().toLowerCase();
        resetFeedback();
        if (!USERNAME_RE.test(normalized)) {
            setError("Enter your username before using a passkey.");
            return;
        }
        setLoading(true);
        setMethod("passkey");
        try {
            const authentication =
                await vexService.authenticateAccountWithPasskey(
                    normalized,
                    webBootstrapConfig(),
                    getServerOptions(),
                    browserKeyStore,
                );
            if (!authentication.ok) {
                setError(
                    authentication.error ?? "Could not verify this passkey.",
                );
                return;
            }
            const local =
                await vexService.finishPasskeyAuthenticatedDeviceSignIn(
                    browserKeyStore,
                );
            if (local.ok) {
                navigateAfterAuthentication();
                return;
            }
            if (!local.needsDeviceApproval) {
                setError(
                    local.error ?? "This browser could not finish signing in.",
                );
                return;
            }
            const approval =
                await vexService.requestDeviceApprovalForPasskeyAuthenticatedAccount(
                    webBootstrapConfig(),
                    getServerOptions(),
                    browserKeyStore,
                );
            if (
                !approval.ok &&
                approval.pendingDeviceApproval &&
                approval.pendingRequestID
            ) {
                setAwaitingApproval(true);
                setNotice(
                    "Passkey verified. Approve this browser from another signed-in device.",
                );
                return;
            }
            if (approval.ok) {
                navigateAfterAuthentication();
                return;
            }
            setError(
                approval.error ??
                    "Could not request approval for this browser.",
            );
        } catch (cause: unknown) {
            if (!isCancelledCredentialRequest(cause)) {
                setError(errorMessage(cause, "Passkey sign in failed."));
            }
        } finally {
            setLoading(false);
            setMethod(null);
        }
    }

    async function register(event: SubmitEvent) {
        event.preventDefault();
        const normalized = username.trim().toLowerCase();
        resetFeedback();
        if (!USERNAME_RE.test(normalized)) {
            setError("Use 3-19 lowercase letters, numbers, or underscores.");
            return;
        }
        if (password.length < 15 || password.length > 1024) {
            setError("Use a password between 15 and 1024 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        try {
            const result = await vexService.register(
                normalized,
                password,
                webBootstrapConfig(),
                getServerOptions(),
                browserKeyStore,
            );
            if (!result.ok) {
                setError(result.error ?? "Registration failed.");
                return;
            }
            navigateAfterAuthentication();
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Registration failed."));
        } finally {
            setLoading(false);
        }
    }

    async function recover(event: SubmitEvent) {
        event.preventDefault();
        const normalized = username.trim().toLowerCase();
        resetFeedback();
        if (!USERNAME_RE.test(normalized)) {
            setError("Enter a valid username.");
            return;
        }
        if (password.length < 15 || password.length > 1024) {
            setError("Use a password between 15 and 1024 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        try {
            const authentication =
                await vexService.authenticateAccountWithPasskey(
                    normalized,
                    webBootstrapConfig(),
                    getServerOptions(),
                    browserKeyStore,
                );
            if (!authentication.ok) {
                setError(
                    authentication.error ??
                        "Could not verify an account passkey.",
                );
                return;
            }
            const result = await vexService.resetPasswordWithPasskey(password);
            if (!result.ok) {
                setError(result.error ?? "Could not reset the password.");
                return;
            }
            await vexService.logout();
            sessionStorage.setItem("vex-password-reset", "complete");
            navigate("/app/login", true);
        } catch (cause: unknown) {
            if (!isCancelledCredentialRequest(cause)) {
                setError(errorMessage(cause, "Password reset failed."));
            }
        } finally {
            setLoading(false);
        }
    }

    function cancelApproval() {
        vexService.cancelPendingApproval();
        setAwaitingApproval(false);
        setNotice("");
    }

    if (awaitingApproval) {
        return (
            <AuthLayout>
                <section className="auth-approval" aria-live="polite">
                    <span className="auth-approval__icon">
                        <ShieldCheck size={25} />
                    </span>
                    <div>
                        <span className="auth-eyebrow">
                            Device verification
                        </span>
                        <h1>Approve this browser</h1>
                        <p>
                            Open Vex on a signed-in device and approve this
                            request.
                        </p>
                    </div>
                    <ApprovalProgress stage={pendingStage} />
                    {notice ? <StatusMessage>{notice}</StatusMessage> : null}
                    <button
                        className="button button--secondary button--wide"
                        type="button"
                        onClick={cancelApproval}
                    >
                        <X size={17} /> Cancel request
                    </button>
                </section>
            </AuthLayout>
        );
    }

    if (route.kind === "register") {
        return (
            <AuthLayout>
                <AuthHeader
                    eyebrow="New account"
                    title="Create your account"
                    subtitle="Start with a password. Add passkeys from Settings later."
                />
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={register}>
                    <UsernameField
                        disabled={loading}
                        value={username}
                        onInput={setUsername}
                        placeholder="pick a username"
                    />
                    <PasswordFields
                        confirm={confirmPassword}
                        disabled={loading}
                        password={password}
                        show={showPassword}
                        onConfirm={setConfirmPassword}
                        onPassword={setPassword}
                    />
                    <ShowPassword
                        checked={showPassword}
                        disabled={loading}
                        plural
                        onChange={setShowPassword}
                    />
                    <button
                        className="button button--primary button--wide"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <LoaderCircle className="spin" size={17} />{" "}
                                Creating account...
                            </>
                        ) : (
                            <>
                                Create account <ArrowRight size={17} />
                            </>
                        )}
                    </button>
                </form>
                <AuthSwitch
                    label="Already have an account?"
                    action="Sign in"
                    path="/app/login"
                />
            </AuthLayout>
        );
    }

    if (route.kind === "recover") {
        return (
            <AuthLayout>
                <button
                    className="auth-back"
                    type="button"
                    onClick={() => navigate("/app/login")}
                >
                    <ArrowLeft size={15} /> Back to sign in
                </button>
                <AuthHeader
                    eyebrow="Account recovery"
                    title="Reset your password"
                    subtitle="An existing account passkey will verify this change."
                />
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={recover}>
                    <UsernameField
                        disabled={loading}
                        value={username}
                        onInput={setUsername}
                        placeholder="your username"
                    />
                    <PasswordFields
                        confirm={confirmPassword}
                        disabled={loading}
                        password={password}
                        show={showPassword}
                        onConfirm={setConfirmPassword}
                        onPassword={setPassword}
                    />
                    <ShowPassword
                        checked={showPassword}
                        disabled={loading}
                        plural
                        onChange={setShowPassword}
                    />
                    <button
                        className="button button--primary button--wide"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <LoaderCircle className="spin" size={17} />{" "}
                                Verifying passkey...
                            </>
                        ) : (
                            <>
                                <KeyRound size={17} /> Verify and reset
                            </>
                        )}
                    </button>
                </form>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout>
            <AuthHeader
                eyebrow="Secure messaging"
                title="Welcome back"
                subtitle="Sign in with your username and password."
            />
            <Feedback error={error} notice={notice} />
            {accounts.length > 0 ? (
                <div className="account-list" aria-label="Saved accounts">
                    {accounts.map((account) => (
                        <button
                            className={
                                username === account.username
                                    ? "account-choice account-choice--active"
                                    : "account-choice"
                            }
                            type="button"
                            onClick={() => setUsername(account.username)}
                            key={account.username}
                        >
                            <UserRound size={16} />
                            <span>{account.username}</span>
                            {username === account.username ? (
                                <Check size={14} />
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : null}
            <form className="auth-form" onSubmit={signIn}>
                <UsernameField
                    disabled={loading}
                    value={username}
                    onInput={setUsername}
                    placeholder="your username"
                />
                <label className="field" htmlFor="login-password">
                    <span>Password</span>
                    <input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        maxLength={1024}
                        placeholder="your password"
                        value={password}
                        disabled={loading}
                        onInput={(event) =>
                            setPassword(event.currentTarget.value)
                        }
                        required
                    />
                </label>
                <div className="auth-options">
                    <ShowPassword
                        checked={showPassword}
                        disabled={loading}
                        onChange={setShowPassword}
                    />
                    <button
                        className="text-button"
                        type="button"
                        onClick={() => navigate("/app/recover")}
                    >
                        Forgot password?
                    </button>
                </div>
                <button
                    className="button button--primary button--wide"
                    disabled={loading}
                >
                    {loading && method === "password" ? (
                        <>
                            <LoaderCircle className="spin" size={17} /> Signing
                            in...
                        </>
                    ) : (
                        <>
                            Sign in <ArrowRight size={17} />
                        </>
                    )}
                </button>
                <button
                    className="button button--secondary button--wide"
                    disabled={loading || !username.trim()}
                    type="button"
                    onClick={() => void signInWithPasskey()}
                >
                    {loading && method === "passkey" ? (
                        <>
                            <LoaderCircle className="spin" size={17} />{" "}
                            Verifying passkey...
                        </>
                    ) : (
                        <>
                            <KeyRound size={17} /> Use a passkey
                        </>
                    )}
                </button>
            </form>
            <AuthSwitch
                label="New to Vex?"
                action="Create account"
                path="/app/register"
            />
        </AuthLayout>
    );
}

function ApprovalProgress({ stage }: { stage: string }) {
    const label =
        stage === "signing_in"
            ? "Approval received. Signing in..."
            : stage === "loading_account"
              ? "Loading your account..."
              : stage === "failed"
                ? "Approval could not be completed."
                : "Waiting for approval...";
    return (
        <div className="approval-progress">
            {stage !== "failed" ? (
                <LoaderCircle className="spin" size={16} />
            ) : null}
            <span>{label}</span>
        </div>
    );
}

function AuthHeader({
    eyebrow,
    subtitle,
    title,
}: {
    eyebrow: string;
    subtitle: string;
    title: string;
}) {
    return (
        <header className="auth-header">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
        </header>
    );
}

function AuthLayout({ children }: { children: ComponentChildren }) {
    return (
        <main className="auth-page">
            <section className="auth-card">
                <VexMark label size={38} />
                {children}
            </section>
        </main>
    );
}

function AuthSwitch({
    action,
    label,
    path,
}: {
    action: string;
    label: string;
    path: string;
}) {
    return (
        <p className="auth-switch">
            {label}{" "}
            <button
                className="text-button"
                type="button"
                onClick={() => navigate(path)}
            >
                {action}
            </button>
        </p>
    );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
    return (
        <>
            {error ? (
                <p className="status status--error" role="alert">
                    {error}
                </p>
            ) : null}
            {notice ? <StatusMessage>{notice}</StatusMessage> : null}
        </>
    );
}

function PasswordFields({
    confirm,
    disabled,
    onConfirm,
    onPassword,
    password,
    show,
}: {
    confirm: string;
    disabled: boolean;
    onConfirm: (value: string) => void;
    onPassword: (value: string) => void;
    password: string;
    show: boolean;
}) {
    return (
        <>
            <label className="field" htmlFor="new-password">
                <span>Password</span>
                <input
                    id="new-password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={1024}
                    placeholder="15 characters or more"
                    value={password}
                    disabled={disabled}
                    onInput={(event) => onPassword(event.currentTarget.value)}
                    required
                />
            </label>
            <label className="field" htmlFor="confirm-password">
                <span>Confirm password</span>
                <input
                    id="confirm-password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={1024}
                    placeholder="enter it again"
                    value={confirm}
                    disabled={disabled}
                    onInput={(event) => onConfirm(event.currentTarget.value)}
                    required
                />
            </label>
        </>
    );
}

function ShowPassword({
    checked,
    disabled,
    onChange,
    plural = false,
}: {
    checked: boolean;
    disabled: boolean;
    onChange: (value: boolean) => void;
    plural?: boolean;
}) {
    return (
        <label className="checkbox-field">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.checked)}
            />
            {checked ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>Show password{plural ? "s" : ""}</span>
        </label>
    );
}

function StatusMessage({ children }: { children: ComponentChildren }) {
    return (
        <p className="status status--notice" role="status">
            {children}
        </p>
    );
}

function UsernameField({
    disabled,
    onInput,
    placeholder,
    value,
}: {
    disabled: boolean;
    onInput: (value: string) => void;
    placeholder: string;
    value: string;
}) {
    return (
        <label className="field" htmlFor="auth-username">
            <span>Username</span>
            <input
                id="auth-username"
                type="text"
                autoCapitalize="none"
                autoComplete="username"
                placeholder={placeholder}
                spellcheck={false}
                value={value}
                disabled={disabled}
                onInput={(event) => onInput(event.currentTarget.value)}
                required
            />
        </label>
    );
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function isCancelledCredentialRequest(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotAllowedError";
}

function navigateAfterAuthentication() {
    const postAuthPath = consumePostAuthPath();
    if (postAuthPath) {
        navigate(postAuthPath, true);
        return;
    }
    const firstServer = Object.values($servers.get()).sort((a, b) =>
        a.name.localeCompare(b.name),
    )[0];
    if (firstServer) {
        const firstChannel = $channels.get()[firstServer.serverID]?.[0];
        if (firstChannel) {
            navigate(
                `/app/server/${firstServer.serverID}/${firstChannel.channelID}`,
                true,
            );
            return;
        }
    }
    navigate("/app/home", true);
}
