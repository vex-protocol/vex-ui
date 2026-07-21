import type { Passkey } from "@vex-chat/libvex";

import {
    Eye,
    EyeOff,
    KeyRound,
    LoaderCircle,
    LockKeyhole,
    Plus,
    RefreshCw,
    Trash2,
} from "lucide-preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { vexService } from "@vex-chat/store";

import { webBootstrapConfig } from "../../lib/config";
import { passkeysAvailable, registerPasskey } from "../../lib/passkey";
import {
    PASSKEY_SETUP_INTENT_EVENT,
    takePasskeySetupIntent,
} from "../../lib/passkeySetupIntent";

export function PasswordSettings() {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [showPasswords, setShowPasswords] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    async function changePassword(event: SubmitEvent) {
        event.preventDefault();
        setError("");
        setNotice("");
        if (!currentPassword) {
            setError("Enter your current password.");
            return;
        }
        if (newPassword.length < 15) {
            setError("Use at least 15 characters for the new password.");
            return;
        }
        if (newPassword.length > 1024) {
            setError("The new password is too long.");
            return;
        }
        if (newPassword !== confirmation) {
            setError("New passwords do not match.");
            return;
        }

        setBusy(true);
        try {
            const result = await vexService.changePassword(
                currentPassword,
                newPassword,
            );
            if (!result.ok) {
                setError(result.error ?? "Could not change your password.");
                return;
            }
            setCurrentPassword("");
            setNewPassword("");
            setConfirmation("");
            setNotice("Password updated. Other login sessions were revoked.");
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not change your password."));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Your password remains the primary way to sign in. Updating it revokes other login sessions while approved devices retain encrypted local history."
                icon={<LockKeyhole size={20} />}
                kicker="Account security"
                title="Password"
            />
            <section className="preference-section">
                <h2>Change password</h2>
                <form className="preference-form" onSubmit={changePassword}>
                    <PasswordField
                        autoComplete="current-password"
                        disabled={busy}
                        label="Current password"
                        show={showPasswords}
                        value={currentPassword}
                        onInput={setCurrentPassword}
                    />
                    <PasswordField
                        autoComplete="new-password"
                        disabled={busy}
                        hint="Use at least 15 characters."
                        label="New password"
                        show={showPasswords}
                        value={newPassword}
                        onInput={setNewPassword}
                    />
                    <PasswordField
                        autoComplete="new-password"
                        disabled={busy}
                        label="Confirm new password"
                        show={showPasswords}
                        value={confirmation}
                        onInput={setConfirmation}
                    />
                    <label className="preference-check">
                        <input
                            checked={showPasswords}
                            type="checkbox"
                            onChange={(event) =>
                                setShowPasswords(event.currentTarget.checked)
                            }
                        />
                        {showPasswords ? (
                            <EyeOff size={15} />
                        ) : (
                            <Eye size={15} />
                        )}
                        Show passwords
                    </label>
                    <Feedback error={error} notice={notice} />
                    <div className="preference-form__actions">
                        <button
                            className="button button--primary"
                            disabled={busy}
                        >
                            {busy ? (
                                <LoaderCircle className="spin" size={16} />
                            ) : (
                                <LockKeyhole size={16} />
                            )}
                            {busy ? "Updating" : "Update password"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

export function PasskeysSettings() {
    const supported = passkeysAvailable() && window.isSecureContext;
    const [passkeys, setPasskeys] = useState<Passkey[]>([]);
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const busyRef = useRef(false);

    const loadPasskeys = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const next = await vexService.listPasskeys();
            setPasskeys(
                [...next].sort(
                    (a, b) =>
                        new Date(b.lastUsedAt ?? b.createdAt).getTime() -
                        new Date(a.lastUsedAt ?? a.createdAt).getTime(),
                ),
            );
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not load passkeys."));
        } finally {
            setLoading(false);
        }
    }, []);

    const addPasskeyNamed = useCallback(
        async (passkeyName: string, isActive: () => boolean = () => true) => {
            if (busyRef.current) return;
            if (!supported) {
                setError("Passkeys are not available in this browser context.");
                return;
            }
            if (!passkeyName) {
                setError("Give the passkey a recognizable name.");
                return;
            }
            busyRef.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
                const begin =
                    await vexService.beginPasskeyRegistration(passkeyName);
                if (!isActive()) return;
                const response = await registerPasskey(begin.options);
                if (!isActive()) return;
                const result = await vexService.finishPasskeyRegistration({
                    name: passkeyName,
                    requestID: begin.requestID,
                    response,
                });
                if (!result.ok) {
                    setError(result.error ?? "Could not add this passkey.");
                    return;
                }
                setName("");
                setNotice("Passkey added.");
                await loadPasskeys();
            } catch (cause: unknown) {
                if (!isCancelledCredentialRequest(cause) && isActive()) {
                    setError(
                        errorMessage(cause, "Could not add this passkey."),
                    );
                }
            } finally {
                busyRef.current = false;
                if (isActive()) setBusy(false);
            }
        },
        [loadPasskeys, supported],
    );

    useEffect(() => {
        let active = true;
        const initialLoad = loadPasskeys();
        const startIntent = async () => {
            const intent = takePasskeySetupIntent(
                webBootstrapConfig().deviceName,
            );
            if (!intent) return;
            setName(intent.suggestedName);
            await initialLoad;
            if (!active) return;
            await addPasskeyNamed(intent.suggestedName, () => active);
        };
        const handleSetupIntent = () => void startIntent();
        window.addEventListener(PASSKEY_SETUP_INTENT_EVENT, handleSetupIntent);
        void startIntent();
        return () => {
            active = false;
            window.removeEventListener(
                PASSKEY_SETUP_INTENT_EVENT,
                handleSetupIntent,
            );
        };
    }, [addPasskeyNamed, loadPasskeys]);

    async function addPasskey(event: SubmitEvent) {
        event.preventDefault();
        const passkeyName = name.trim();
        if (!supported) {
            setError("Passkeys are not available in this browser context.");
            return;
        }
        if (!passkeyName) {
            setError("Give the passkey a recognizable name.");
            return;
        }
        await addPasskeyNamed(passkeyName);
    }

    async function removePasskey(passkey: Passkey) {
        if (
            busy ||
            !window.confirm(
                `Remove "${passkey.name}"? Your password and other passkeys will continue to work.`,
            )
        ) {
            return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const result = await vexService.deletePasskey(passkey.passkeyID);
            if (!result.ok) {
                setError(result.error ?? "Could not remove this passkey.");
                return;
            }
            setNotice("Passkey removed.");
            await loadPasskeys();
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Passkeys supplement your password with biometrics or a hardware security key. Vex never receives the passkey secret."
                icon={<KeyRound size={20} />}
                kicker="Account security"
                title="Passkeys"
            />
            <section className="preference-section">
                <div className="preference-section__heading">
                    <h2>Your passkeys</h2>
                    <button
                        aria-label="Refresh passkeys"
                        className="settings-icon-button"
                        disabled={loading}
                        title="Refresh passkeys"
                        type="button"
                        onClick={() => void loadPasskeys()}
                    >
                        <RefreshCw
                            className={loading ? "spin" : undefined}
                            size={15}
                        />
                    </button>
                </div>
                <div className="preference-rows">
                    {passkeys.map((passkey) => (
                        <div className="preference-row" key={passkey.passkeyID}>
                            <span className="preference-row__icon">
                                <KeyRound size={17} />
                            </span>
                            <span className="preference-row__copy">
                                <strong>{passkey.name}</strong>
                                <small>
                                    {passkey.lastUsedAt
                                        ? `Last used ${formatDate(passkey.lastUsedAt)}`
                                        : `Added ${formatDate(passkey.createdAt)}`}
                                </small>
                            </span>
                            <button
                                aria-label={`Remove ${passkey.name}`}
                                className="settings-icon-button is-danger"
                                disabled={busy}
                                title={`Remove ${passkey.name}`}
                                type="button"
                                onClick={() => void removePasskey(passkey)}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                    {!loading && !passkeys.length ? (
                        <div className="preference-row preference-row--empty">
                            <span className="preference-row__icon">
                                <KeyRound size={17} />
                            </span>
                            <span className="preference-row__copy">
                                <strong>No passkeys yet</strong>
                                <small>
                                    Your password continues to work normally.
                                </small>
                            </span>
                        </div>
                    ) : null}
                </div>
            </section>

            <section className="preference-section">
                <h2>Add a passkey</h2>
                <form className="preference-form" onSubmit={addPasskey}>
                    <label className="preference-field">
                        <span>Name</span>
                        <input
                            autoComplete="off"
                            disabled={!supported || busy}
                            maxLength={64}
                            placeholder="MacBook, YubiKey, etc."
                            value={name}
                            onInput={(event) =>
                                setName(event.currentTarget.value)
                            }
                        />
                    </label>
                    {!supported ? (
                        <p className="preference-hint">
                            Passkeys require a supported browser in a secure
                            HTTPS context.
                        </p>
                    ) : null}
                    <Feedback error={error} notice={notice} />
                    <div className="preference-form__actions">
                        <button
                            className="button button--primary"
                            disabled={!supported || busy || !name.trim()}
                        >
                            {busy ? (
                                <LoaderCircle className="spin" size={16} />
                            ) : (
                                <Plus size={16} />
                            )}
                            {busy ? "Verifying" : "Add passkey"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

function SettingsIntro({
    description,
    icon,
    kicker,
    title,
}: {
    description: string;
    icon: preact.ComponentChildren;
    kicker: string;
    title: string;
}) {
    return (
        <header className="account-settings-intro">
            <span className="account-settings-intro__icon">{icon}</span>
            <div>
                <span>{kicker}</span>
                <h1>{title}</h1>
                <p>{description}</p>
            </div>
        </header>
    );
}

function PasswordField({
    autoComplete,
    disabled,
    hint,
    label,
    onInput,
    show,
    value,
}: {
    autoComplete: string;
    disabled: boolean;
    hint?: string;
    label: string;
    onInput: (value: string) => void;
    show: boolean;
    value: string;
}) {
    return (
        <label className="preference-field">
            <span>{label}</span>
            <input
                autoComplete={autoComplete}
                disabled={disabled}
                maxLength={1024}
                minLength={label === "Current password" ? undefined : 15}
                type={show ? "text" : "password"}
                value={value}
                onInput={(event) => onInput(event.currentTarget.value)}
            />
            {hint ? <small>{hint}</small> : null}
        </label>
    );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
    if (!error && !notice) return null;
    return (
        <div
            className={error ? "status status--error" : "status status--notice"}
            role={error ? "alert" : "status"}
        >
            {error || notice}
        </div>
    );
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isCancelledCredentialRequest(cause: unknown): boolean {
    return cause instanceof DOMException && cause.name === "NotAllowedError";
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}
