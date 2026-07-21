import type { AccentPresetID } from "@vex-chat/ui/theme";
import type { ComponentChildren } from "preact";

import {
    ArrowLeft,
    Bell,
    Check,
    ChevronRight,
    CircleUserRound,
    Database,
    HardDrive,
    KeyRound,
    Laptop,
    LoaderCircle,
    LockKeyhole,
    LogOut,
    Moon,
    Network,
    Palette,
    RefreshCw,
    ShieldCheck,
    Sun,
    Trash2,
    Upload,
    Volume2,
    VolumeX,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import {
    $channels,
    $localMessageRetentionDays,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";
import { accentPresets } from "@vex-chat/ui/theme";

import { Avatar } from "../components/Avatar";
import {
    browserNotificationState,
    getBrowserNotificationsEnabled,
    getSoundsEnabled,
    requestBrowserNotifications,
    setBrowserNotificationsEnabled,
    setSoundsEnabled,
    showBrowserNotification,
    type BrowserNotificationState,
} from "../lib/browserNotifications";
import { browserKeyStore } from "../lib/config";
import { getServerHost, setServerHost } from "../lib/config";
import { navigate, settingsPath, type SettingsSection } from "../lib/router";
import { useWebTheme } from "../lib/theme";
import { useStoreValue } from "../lib/useStoreValue";
import { DeviceSettings } from "./settings/DeviceSettings";
import {
    PasskeysSettings,
    PasswordSettings,
} from "./settings/SettingsSecurityViews";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const RETENTION_CHOICES = [1, 7, 14, 30] as const;

const SETTINGS_NAV: ReadonlyArray<{
    icon: ComponentChildren;
    label: string;
    section: SettingsSection;
}> = [
    {
        icon: <CircleUserRound size={16} />,
        label: "Account",
        section: "account",
    },
    { icon: <Palette size={16} />, label: "Appearance", section: "appearance" },
    {
        icon: <Bell size={16} />,
        label: "Notifications",
        section: "notifications",
    },
    { icon: <Network size={16} />, label: "Connection", section: "connection" },
    { icon: <Laptop size={16} />, label: "Devices", section: "devices" },
    { icon: <LockKeyhole size={16} />, label: "Password", section: "password" },
    { icon: <KeyRound size={16} />, label: "Passkeys", section: "passkeys" },
    { icon: <HardDrive size={16} />, label: "Data", section: "data" },
];

export function SettingsView({ section }: { section: SettingsSection }) {
    return (
        <section className="settings-page account-settings-page">
            <header className="settings-page__topbar">
                <button
                    aria-label="Back to Home"
                    title="Back to Home"
                    type="button"
                    onClick={() => navigate("/app/home")}
                >
                    <ArrowLeft size={18} />
                </button>
                <span>
                    <small>Vex</small>
                    <strong>Settings</strong>
                </span>
            </header>
            <div className="settings-page__layout">
                <nav className="settings-nav" aria-label="Settings sections">
                    {SETTINGS_NAV.map((entry) => (
                        <button
                            aria-current={
                                section === entry.section ? "page" : undefined
                            }
                            className={
                                section === entry.section
                                    ? "is-active"
                                    : undefined
                            }
                            key={entry.section}
                            type="button"
                            onClick={() =>
                                navigate(settingsPath(entry.section))
                            }
                        >
                            {entry.icon}
                            {entry.label}
                        </button>
                    ))}
                </nav>
                <main className="settings-content account-settings-scroll">
                    <SettingsContent section={section} />
                </main>
            </div>
        </section>
    );
}

function SettingsContent({ section }: { section: SettingsSection }) {
    switch (section) {
        case "appearance":
            return <AppearanceSettings />;
        case "connection":
            return <ConnectionSettings />;
        case "data":
            return <DataSettings />;
        case "devices":
            return <DeviceSettings />;
        case "notifications":
            return <NotificationSettings />;
        case "passkeys":
            return <PasskeysSettings />;
        case "password":
            return <PasswordSettings />;
        default:
            return <AccountSettings />;
    }
}

function AccountSettings() {
    const user = useStoreValue($user);
    const servers = useStoreValue($servers);
    const channels = useStoreValue($channels);
    const [fingerprint, setFingerprint] = useState("Loading...");
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const avatarInput = useRef<HTMLInputElement | null>(null);
    const channelCount = Object.values(channels).reduce(
        (total, entries) => total + entries.length,
        0,
    );

    useEffect(() => {
        let active = true;
        void browserKeyStore.loadActive().then((credentials) => {
            if (!active) return;
            setFingerprint(
                credentials?.deviceKey
                    ? `${credentials.deviceKey.slice(0, 16).toUpperCase()}...`
                    : "Unavailable",
            );
        });
        return () => {
            active = false;
        };
    }, []);

    async function uploadAvatar(file: File | undefined) {
        if (!file || !user || avatarBusy) return;
        setError("");
        setNotice("");
        if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
            setError("Choose a JPEG, PNG, GIF, AVIF, or WebP image.");
            return;
        }
        if (file.size > MAX_AVATAR_BYTES) {
            setError("Profile pictures must be 5 MB or smaller.");
            return;
        }
        setAvatarBusy(true);
        try {
            const result = await vexService.setAvatar(
                new Uint8Array(await file.arrayBuffer()),
            );
            if (!result.ok) {
                setError(
                    result.error ?? "Could not update your profile picture.",
                );
                return;
            }
            setNotice("Profile picture updated.");
        } catch (cause: unknown) {
            setError(
                errorMessage(cause, "Could not update your profile picture."),
            );
        } finally {
            setAvatarBusy(false);
            if (avatarInput.current) avatarInput.current.value = "";
        }
    }

    async function signOut() {
        if (!window.confirm("Sign out of Vex in this browser?")) return;
        await vexService.logout();
        await browserKeyStore.deactivate();
        navigate("/app/login", true);
    }

    if (!user) return null;
    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Manage the identity and security controls associated with this browser."
                icon={<CircleUserRound size={20} />}
                kicker="Profile"
                title="Account"
            />
            <Feedback error={error} notice={notice} />

            <section className="preference-section">
                <h2>Profile picture</h2>
                <div className="profile-avatar-row">
                    <Avatar
                        name={user.username}
                        size={72}
                        userID={user.userID}
                    />
                    <span>
                        <strong>{user.username}</strong>
                        <small>JPEG, PNG, GIF, AVIF, or WebP, up to 5 MB</small>
                    </span>
                    <input
                        accept="image/jpeg,image/png,image/gif,image/avif,image/webp"
                        className="visually-hidden"
                        ref={avatarInput}
                        type="file"
                        onChange={(event) =>
                            void uploadAvatar(event.currentTarget.files?.[0])
                        }
                    />
                    <button
                        className="button button--secondary"
                        disabled={avatarBusy}
                        type="button"
                        onClick={() => avatarInput.current?.click()}
                    >
                        {avatarBusy ? (
                            <LoaderCircle className="spin" size={16} />
                        ) : (
                            <Upload size={16} />
                        )}
                        {avatarBusy ? "Uploading" : "Change"}
                    </button>
                </div>
            </section>

            <section className="preference-section">
                <h2>Identity</h2>
                <div className="preference-rows">
                    <StaticRow
                        label="Username"
                        mono
                        value={`@${user.username}`}
                    />
                    <StaticRow label="User ID" mono value={user.userID} />
                    <StaticRow
                        label="Device fingerprint"
                        mono
                        value={fingerprint}
                    />
                    <StaticRow
                        label="Encrypted spaces"
                        value={`${Object.keys(servers).length} groups, ${channelCount} channels`}
                    />
                </div>
            </section>

            <section className="preference-section">
                <h2>Security</h2>
                <div className="preference-rows">
                    <LinkRow
                        description="Review trusted devices and approval requests"
                        icon={<ShieldCheck size={17} />}
                        label="Devices"
                        section="devices"
                    />
                    <LinkRow
                        description="Change your primary sign-in password"
                        icon={<LockKeyhole size={17} />}
                        label="Password"
                        section="password"
                    />
                    <LinkRow
                        description="Manage optional biometric or security-key sign-in"
                        icon={<KeyRound size={17} />}
                        label="Passkeys"
                        section="passkeys"
                    />
                </div>
            </section>

            <section className="preference-section preference-section--danger">
                <h2>Account access</h2>
                <div className="preference-row">
                    <span className="preference-row__icon is-danger">
                        <LogOut size={17} />
                    </span>
                    <span className="preference-row__copy">
                        <strong>Sign out</strong>
                        <small>
                            Your encrypted local history stays in this browser.
                        </small>
                    </span>
                    <button
                        className="button button--secondary is-danger"
                        type="button"
                        onClick={() => void signOut()}
                    >
                        Sign out
                    </button>
                </div>
            </section>
        </div>
    );
}

function AppearanceSettings() {
    const theme = useWebTheme();
    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Choose the contrast and primary color that feel best to you. The selection stays local to this browser."
                icon={<Palette size={20} />}
                kicker="Personalization"
                title="Appearance"
            />
            <section className="preference-section">
                <h2>Theme</h2>
                <div className="theme-choice" role="group" aria-label="Theme">
                    <button
                        aria-pressed={theme.scheme === "dark"}
                        className={
                            theme.scheme === "dark" ? "is-active" : undefined
                        }
                        type="button"
                        onClick={() => theme.setScheme("dark")}
                    >
                        <Moon size={17} /> Dark
                    </button>
                    <button
                        aria-pressed={theme.scheme === "light"}
                        className={
                            theme.scheme === "light" ? "is-active" : undefined
                        }
                        type="button"
                        onClick={() => theme.setScheme("light")}
                    >
                        <Sun size={17} /> Light
                    </button>
                </div>
            </section>
            <section className="preference-section">
                <h2>Primary color</h2>
                <div className="accent-choice-grid" role="radiogroup">
                    {accentPresets.map((preset) => (
                        <button
                            aria-checked={theme.accent === preset.id}
                            aria-label={`${preset.label} primary color`}
                            className={
                                theme.accent === preset.id
                                    ? "is-active"
                                    : undefined
                            }
                            key={preset.id}
                            role="radio"
                            type="button"
                            onClick={() =>
                                theme.setAccent(preset.id as AccentPresetID)
                            }
                        >
                            <span style={{ background: preset.color }}>
                                {theme.accent === preset.id ? (
                                    <Check size={17} />
                                ) : null}
                            </span>
                            {preset.label}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

function NotificationSettings() {
    const [permission, setPermission] = useState<BrowserNotificationState>(() =>
        browserNotificationState(),
    );
    const [enabled, setEnabled] = useState(() =>
        getBrowserNotificationsEnabled(),
    );
    const [sounds, setSounds] = useState(() => getSoundsEnabled());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        const refresh = () => {
            setPermission(browserNotificationState());
            setEnabled(getBrowserNotificationsEnabled());
        };
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, []);

    async function toggleNotifications() {
        setError("");
        setNotice("");
        if (enabled) {
            setBrowserNotificationsEnabled(false);
            setEnabled(false);
            return;
        }
        setBusy(true);
        try {
            const granted = await requestBrowserNotifications();
            setPermission(browserNotificationState());
            setEnabled(granted);
            if (!granted) {
                setError(
                    permission === "unsupported"
                        ? "This browser does not support system notifications."
                        : "Notifications are blocked. Allow them in the browser site settings.",
                );
            }
        } finally {
            setBusy(false);
        }
    }

    async function testNotification() {
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const granted = enabled || (await requestBrowserNotifications());
            setPermission(browserNotificationState());
            setEnabled(granted);
            if (!granted) {
                setError(
                    "Allow notifications in the browser site settings first.",
                );
                return;
            }
            const sent = showBrowserNotification(
                "Vex notifications are ready",
                {
                    body: "New messages can alert you while this browser is in the background.",
                    tag: "vex-notification-test",
                },
            );
            setNotice(
                sent
                    ? "Test notification sent."
                    : "The browser could not show the test notification.",
            );
        } finally {
            setBusy(false);
        }
    }

    function toggleSounds() {
        const next = !sounds;
        setSounds(next);
        setSoundsEnabled(next);
    }

    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Control browser alerts and message sounds. Message contents remain encrypted on the server."
                icon={<Bell size={20} />}
                kicker="Alerts"
                title="Notifications"
            />
            <Feedback error={error} notice={notice} />
            <section className="preference-section">
                <h2>Browser alerts</h2>
                <div className="preference-rows">
                    <div className="preference-row">
                        <span className="preference-row__icon">
                            <Bell size={17} />
                        </span>
                        <span className="preference-row__copy">
                            <strong>System notifications</strong>
                            <small>
                                {notificationDescription(permission, enabled)}
                            </small>
                        </span>
                        <Toggle
                            checked={enabled}
                            disabled={busy || permission === "unsupported"}
                            label="System notifications"
                            onChange={() => void toggleNotifications()}
                        />
                    </div>
                    <div className="preference-row">
                        <span className="preference-row__icon">
                            {sounds ? (
                                <Volume2 size={17} />
                            ) : (
                                <VolumeX size={17} />
                            )}
                        </span>
                        <span className="preference-row__copy">
                            <strong>Message sounds</strong>
                            <small>
                                Play a subtle sound for background messages.
                            </small>
                        </span>
                        <Toggle
                            checked={sounds}
                            label="Message sounds"
                            onChange={toggleSounds}
                        />
                    </div>
                </div>
                <div className="preference-section__actions">
                    <button
                        className="button button--secondary"
                        disabled={busy || permission === "unsupported"}
                        type="button"
                        onClick={() => void testNotification()}
                    >
                        <Bell size={16} /> Test notification
                    </button>
                </div>
            </section>
            <p className="preference-note">
                Browser alerts are delivered while Vex is open in a tab. Full
                background push delivery depends on browser and installation
                support.
            </p>
        </div>
    );
}

function ConnectionSettings() {
    const [host, setHost] = useState(() => getServerHost());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function save(event: SubmitEvent) {
        event.preventDefault();
        const normalized = host.trim();
        if (!normalized || busy) return;
        setBusy(true);
        setError("");
        try {
            setServerHost(normalized);
            await vexService.logout();
            await browserKeyStore.deactivate();
            window.location.assign("/app/login");
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not change homeserver."));
            setBusy(false);
        }
    }

    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Choose the Vex homeserver used by this browser. Changing it signs out the current connection."
                icon={<Network size={20} />}
                kicker="Network"
                title="Connection"
            />
            <section className="preference-section">
                <h2>Homeserver</h2>
                <form className="preference-form" onSubmit={save}>
                    <label className="preference-field">
                        <span>Server host</span>
                        <input
                            autoCapitalize="none"
                            autoComplete="url"
                            disabled={busy}
                            inputMode="url"
                            placeholder="api.vex.wtf"
                            spellcheck={false}
                            value={host}
                            onInput={(event) =>
                                setHost(event.currentTarget.value)
                            }
                        />
                        <small>
                            HTTPS is required except for local development.
                        </small>
                    </label>
                    <Feedback error={error} notice="" />
                    <div className="preference-form__actions">
                        <button
                            className="button button--primary"
                            disabled={busy || !host.trim()}
                        >
                            {busy ? (
                                <LoaderCircle className="spin" size={16} />
                            ) : (
                                <Network size={16} />
                            )}
                            {busy ? "Reconnecting" : "Save and reconnect"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

function DataSettings() {
    const retention = useStoreValue($localMessageRetentionDays);
    const [storage, setStorage] = useState("Calculating...");
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        void navigator.storage?.estimate().then((estimate) => {
            if (!active) return;
            const usage = estimate.usage ?? 0;
            const quota = estimate.quota ?? 0;
            setStorage(
                quota > 0
                    ? `${formatBytes(usage)} used of ${formatBytes(quota)}`
                    : formatBytes(usage),
            );
        });
        return () => {
            active = false;
        };
    }, []);

    function resetUnread() {
        vexService.resetAllUnread();
        setNotice("Unread counters reset.");
        setError("");
    }

    async function deleteLocalData() {
        if (
            busy ||
            !window.confirm(
                "Delete this account's encrypted history, device keys, and saved credentials from this browser? This cannot be undone.",
            )
        ) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            const credentials = await browserKeyStore.loadActive();
            await vexService.deleteAllData();
            if (credentials?.username) {
                await browserKeyStore.clear(credentials.username);
            }
            await browserKeyStore.deactivate();
            window.location.assign("/app/login");
        } catch (cause: unknown) {
            setError(errorMessage(cause, "Could not delete local data."));
            setBusy(false);
        }
    }

    return (
        <div className="account-settings-content">
            <SettingsIntro
                description="Control decrypted history retained by this browser and clear local state when needed."
                icon={<Database size={20} />}
                kicker="Storage"
                title="Data"
            />
            <Feedback error={error} notice={notice} />
            <section className="preference-section">
                <h2>Local message history</h2>
                <div className="retention-options" role="radiogroup">
                    {RETENTION_CHOICES.map((days) => (
                        <button
                            aria-checked={retention === days}
                            className={
                                retention === days ? "is-active" : undefined
                            }
                            key={days}
                            role="radio"
                            type="button"
                            onClick={() => {
                                vexService.setLocalMessageRetentionDays(days);
                                setNotice(`Local history set to ${days} days.`);
                            }}
                        >
                            {days} {days === 1 ? "day" : "days"}
                            {retention === days ? <Check size={15} /> : null}
                        </button>
                    ))}
                </div>
                <p className="preference-note">
                    The server removes undelivered mail after 30 days. This
                    setting can retain fewer decrypted messages on this browser.
                </p>
            </section>
            <section className="preference-section">
                <h2>Browser storage</h2>
                <div className="preference-rows">
                    <StaticRow label="Estimated usage" value={storage} />
                    <div className="preference-row">
                        <span className="preference-row__icon">
                            <RefreshCw size={17} />
                        </span>
                        <span className="preference-row__copy">
                            <strong>Unread counters</strong>
                            <small>
                                Clear badges without deleting messages.
                            </small>
                        </span>
                        <button
                            className="button button--secondary"
                            type="button"
                            onClick={resetUnread}
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>
            <section className="preference-section preference-section--danger">
                <h2>Delete local data</h2>
                <div className="preference-row">
                    <span className="preference-row__icon is-danger">
                        <Trash2 size={17} />
                    </span>
                    <span className="preference-row__copy">
                        <strong>Remove this account from the browser</strong>
                        <small>
                            Deletes encrypted history, sessions, device keys,
                            and saved credentials locally.
                        </small>
                    </span>
                    <button
                        className="button button--secondary is-danger"
                        disabled={busy}
                        type="button"
                        onClick={() => void deleteLocalData()}
                    >
                        {busy ? (
                            <LoaderCircle className="spin" size={16} />
                        ) : (
                            <Trash2 size={16} />
                        )}
                        Delete
                    </button>
                </div>
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
    icon: ComponentChildren;
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

function StaticRow({
    label,
    mono = false,
    value,
}: {
    label: string;
    mono?: boolean;
    value: string;
}) {
    return (
        <div className="preference-row">
            <span className="preference-row__copy">
                <strong>{label}</strong>
            </span>
            <span
                className={
                    mono
                        ? "preference-row__value is-mono"
                        : "preference-row__value"
                }
            >
                {value}
            </span>
        </div>
    );
}

function LinkRow({
    description,
    icon,
    label,
    section,
}: {
    description: string;
    icon: ComponentChildren;
    label: string;
    section: SettingsSection;
}) {
    return (
        <button
            className="preference-row preference-row--link"
            type="button"
            onClick={() => navigate(settingsPath(section))}
        >
            <span className="preference-row__icon">{icon}</span>
            <span className="preference-row__copy">
                <strong>{label}</strong>
                <small>{description}</small>
            </span>
            <ChevronRight size={16} />
        </button>
    );
}

function Toggle({
    checked,
    disabled = false,
    label,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: () => void;
}) {
    return (
        <button
            aria-checked={checked}
            aria-label={label}
            className={checked ? "toggle-control is-on" : "toggle-control"}
            disabled={disabled}
            role="switch"
            type="button"
            onClick={onChange}
        >
            <span />
        </button>
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

function notificationDescription(
    permission: BrowserNotificationState,
    enabled: boolean,
): string {
    if (permission === "unsupported") return "Unavailable in this browser";
    if (permission === "denied") return "Blocked in browser site settings";
    if (enabled)
        return "Enabled for background messages while this tab is open";
    return permission === "granted"
        ? "Allowed but turned off"
        : "Permission not requested";
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function errorMessage(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}
