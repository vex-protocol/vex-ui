<script lang="ts">
    import type { StoredCredentials } from "@vex-chat/libvex";

    import { push } from "svelte-spa-router";

    import Avatar from "../lib/Avatar.svelte";
    import { getServerUrl, setServerUrl } from "../lib/config.js";
    import {
        clearActiveUsername,
        clearCredentials,
        keyStore,
    } from "../lib/keystore.js";
    import {
        getNotificationsEnabled,
        setNotificationsEnabled,
    } from "../lib/notifications.js";
    import {
        getSoundsEnabled,
        playNotify,
        setSoundsEnabled,
    } from "../lib/sounds.js";
    import {
        avatarHash,
        channels,
        localMessageRetentionDays,
        servers,
        setLocalMessageRetentionDaysPreference,
        user,
        vexService,
    } from "../lib/store/index.js";
    import { theme, toggleTheme } from "../lib/stores/theme.js";
    import {
        applyUpdate,
        checkForUpdates,
        type UpdateStatus,
    } from "../lib/updater.js";

    let { params = {} }: { params?: Record<string, string> } = $props();

    type Section = "about" | "account" | "data" | "developer" | "notifications";

    const section = $derived((params.section ?? "") as "" | Section);
    const serverCount = $derived(Object.keys($servers).length);
    const channelCount = $derived(
        Object.values($channels).reduce(
            (total, list) => total + list.length,
            0,
        ),
    );

    let creds = $state<null | StoredCredentials>(null);
    let serverUrl = $state(getServerUrl());
    let serverUrlSaved = $state(false);
    let soundsEnabled = $state(getSoundsEnabled());
    let notificationsEnabled = $state(getNotificationsEnabled());
    let avatarInput: HTMLInputElement | undefined = $state();
    let avatarError = $state("");
    let avatarNotice = $state("");
    let avatarUploading = $state(false);
    let confirmDeleteAll = $state(false);
    let loggingOut = $state(false);
    let updateStatus: UpdateStatus = $state({
        available: false,
        downloading: false,
        progress: 0,
        readyToInstall: false,
    });
    let checking = $state(false);
    let wsDebugEnabled = $state(vexService.getWebsocketDebugEnabled());
    let wsFrameDebugEnabled = $state(
        vexService.getWebsocketFrameDebugEnabled(),
    );
    let wsStateDebugEnabled = $state(
        vexService.getWebsocketStateDebugEnabled(),
    );

    const fingerprint = $derived(
        creds?.deviceKey
            ? `${creds.deviceKey.slice(0, 16).toUpperCase()}...`
            : "N/A",
    );

    void keyStore.loadActive().then((loaded) => {
        creds = loaded;
    });

    function sectionTitle(value: "" | Section): string {
        switch (value) {
            case "about":
                return "About";
            case "account":
                return "Account";
            case "data":
                return "Data";
            case "developer":
                return "Developer";
            case "notifications":
                return "Notifications";
            default:
                return "Settings";
        }
    }

    function toggleSounds(): void {
        soundsEnabled = !soundsEnabled;
        setSoundsEnabled(soundsEnabled);
        if (soundsEnabled) playNotify();
    }

    function toggleNotifications(): void {
        notificationsEnabled = !notificationsEnabled;
        setNotificationsEnabled(notificationsEnabled);
    }

    function saveServerUrl(): void {
        setServerUrl(serverUrl.trim());
        serverUrlSaved = true;
        setTimeout(() => {
            serverUrlSaved = false;
        }, 2000);
    }

    async function handleAvatarChange(e: Event): Promise<void> {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            avatarError = "Image must be under 5 MB.";
            return;
        }
        avatarUploading = true;
        avatarError = "";
        avatarNotice = "";
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            const result = await vexService.setAvatar(data);
            if (!result.ok) throw new Error(result.error ?? "Upload failed.");
            avatarNotice = "Avatar updated.";
        } catch (err: unknown) {
            avatarError = err instanceof Error ? err.message : "Upload failed.";
        } finally {
            avatarUploading = false;
            if (avatarInput) avatarInput.value = "";
        }
    }

    async function handleLogout(): Promise<void> {
        loggingOut = true;
        try {
            await vexService.logout();
            const active = await keyStore.loadActive();
            if (active) {
                await keyStore.save({ ...active, token: undefined });
            }
            await clearActiveUsername();
        } finally {
            loggingOut = false;
            void push("/accounts");
        }
    }

    async function handleDeleteAllData(): Promise<void> {
        try {
            await vexService.deleteAllData();
        } catch {
            /* ignore */
        }
        if (creds?.username) {
            await clearCredentials(creds.username);
        }
        await clearActiveUsername();
        confirmDeleteAll = false;
        window.location.hash = "#/login";
    }

    async function handleCheckUpdate(): Promise<void> {
        checking = true;
        await checkForUpdates((status) => {
            updateStatus = status;
        });
        checking = false;
    }

    function setRetention(days: number): void {
        setLocalMessageRetentionDaysPreference(days);
        vexService.setLocalMessageRetentionDays(days);
    }

    const settingsRows = [
        {
            desc: "Profile, identity, memberships, sign out",
            href: "/settings/account",
            label: "Account",
        },
        {
            desc: "Manage signed-in devices",
            href: "/devices",
            label: "Devices",
        },
        {
            desc: "Account recovery keys",
            href: "/passkeys",
            label: "Passkeys",
        },
        {
            desc: "OS alerts and sound effects",
            href: "/settings/notifications",
            label: "Notifications",
        },
        {
            desc: "Unread counters and local retention",
            href: "/settings/data",
            label: "Data",
        },
        {
            desc: "Connection and WebSocket diagnostics",
            href: "/settings/developer",
            label: "Developer",
        },
        {
            desc: "Version and updates",
            href: "/settings/about",
            label: "About",
        },
    ];
</script>

<div class="desktop-page">
    <header class="desktop-page__header">
        <div class="desktop-page__heading">
            <button
                class="desktop-page__back"
                onclick={() => {
                    if (section) void push("/settings");
                    else history.back();
                }}
                aria-label="Go back">←</button
            >
            <div>
                <h1 class="desktop-page__title">{sectionTitle(section)}</h1>
                <p class="desktop-page__subtitle">Desktop client settings</p>
            </div>
        </div>
    </header>

    <main class="desktop-page__body">
        {#if !section}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Settings</h2>
                {#each settingsRows as row (row.href)}
                    <button
                        class="desktop-row settings-link"
                        onclick={() => void push(row.href)}
                    >
                        <div class="desktop-row__info">
                            <span class="desktop-row__label">{row.label}</span>
                            <span class="desktop-row__desc">{row.desc}</span>
                        </div>
                        <span class="settings-link__chevron">›</span>
                    </button>
                {/each}
            </section>
        {/if}

        {#if section === "account"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Profile</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Avatar</span>
                        <span class="desktop-row__desc">
                            Upload JPG, PNG, GIF, or WebP, max 5 MB.
                        </span>
                    </div>
                    <div class="desktop-actions">
                        {#if $user?.userID}
                            <Avatar
                                userID={$user.userID}
                                {serverUrl}
                                version={$avatarHash}
                                size={40}
                                name={$user.username}
                            />
                        {/if}
                        <button
                            class="desktop-button"
                            onclick={() => avatarInput?.click()}
                            disabled={avatarUploading}
                        >
                            {avatarUploading ? "Uploading..." : "Change"}
                        </button>
                        <input
                            bind:this={avatarInput}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            style="display:none"
                            onchange={handleAvatarChange}
                        />
                    </div>
                </div>
                {#if avatarError}
                    <div class="desktop-row">
                        <span class="desktop-status desktop-status--error">
                            {avatarError}
                        </span>
                    </div>
                {:else if avatarNotice}
                    <div class="desktop-row">
                        <span class="desktop-status desktop-status--success">
                            {avatarNotice}
                        </span>
                    </div>
                {/if}
                <div class="desktop-row">
                    <span class="desktop-row__label">Username</span>
                    <span class="desktop-value"
                        >{$user?.username ?? creds?.username ?? "-"}</span
                    >
                </div>
                <div class="desktop-row desktop-row--column">
                    <span class="desktop-row__label">User ID</span>
                    <span class="desktop-value desktop-mono"
                        >{$user?.userID ?? "-"}</span
                    >
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Device fingerprint</span>
                    <span class="desktop-value desktop-mono">{fingerprint}</span
                    >
                </div>
            </section>

            <section class="desktop-section">
                <h2 class="desktop-section__title">Memberships</h2>
                <div class="desktop-row">
                    <span class="desktop-row__label">Groups</span>
                    <span class="desktop-value">{serverCount}</span>
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Channels</span>
                    <span class="desktop-value">{channelCount}</span>
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Session</span>
                    <button
                        class="desktop-button"
                        onclick={() => void push("/session")}
                    >
                        View details
                    </button>
                </div>
            </section>

            <section class="desktop-section">
                <h2 class="desktop-section__title">Account</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Sign out</span>
                        <span class="desktop-row__desc">
                            Return to the account picker.
                        </span>
                    </div>
                    <button
                        class="desktop-button desktop-button--danger"
                        onclick={() => void handleLogout()}
                        disabled={loggingOut}
                    >
                        {loggingOut ? "Signing out..." : "Sign out"}
                    </button>
                </div>
            </section>
        {/if}

        {#if section === "notifications"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Notifications</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label"
                            >Desktop notifications</span
                        >
                        <span class="desktop-row__desc">
                            Show OS alerts for incoming messages when Vex is not
                            focused.
                        </span>
                    </div>
                    <button
                        class="desktop-button {notificationsEnabled
                            ? 'desktop-button--primary'
                            : ''}"
                        onclick={toggleNotifications}
                    >
                        {notificationsEnabled ? "On" : "Off"}
                    </button>
                </div>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Sound effects</span>
                        <span class="desktop-row__desc">
                            Play local sounds for app events and messages.
                        </span>
                    </div>
                    <button
                        class="desktop-button {soundsEnabled
                            ? 'desktop-button--primary'
                            : ''}"
                        onclick={toggleSounds}
                    >
                        {soundsEnabled ? "On" : "Off"}
                    </button>
                </div>
            </section>

            <section class="desktop-section">
                <h2 class="desktop-section__title">Appearance</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Theme</span>
                        <span class="desktop-row__desc">
                            Toggle between dark and light mode.
                        </span>
                    </div>
                    <button class="desktop-button" onclick={toggleTheme}>
                        {$theme === "dark"
                            ? "Switch to Light"
                            : "Switch to Dark"}
                    </button>
                </div>
            </section>
        {/if}

        {#if section === "data"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Local message history</h2>
                {#each [7, 14, 21, 30] as days (days)}
                    <div class="desktop-row">
                        <div class="desktop-row__info">
                            <span class="desktop-row__label">{days} days</span>
                            <span class="desktop-row__desc">
                                {days === $localMessageRetentionDays
                                    ? "Currently selected"
                                    : `Keep decrypted messages up to ${days} days`}
                            </span>
                        </div>
                        <button
                            class="desktop-button {days ===
                            $localMessageRetentionDays
                                ? 'desktop-button--primary'
                                : ''}"
                            onclick={() => setRetention(days)}
                        >
                            {days === $localMessageRetentionDays
                                ? "Selected"
                                : "Select"}
                        </button>
                    </div>
                {/each}
            </section>

            <section class="desktop-section">
                <h2 class="desktop-section__title">Local data</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label"
                            >Reset unread counters</span
                        >
                        <span class="desktop-row__desc">
                            Clears local unread badges on this desktop.
                        </span>
                    </div>
                    <button
                        class="desktop-button desktop-button--danger"
                        onclick={() => vexService.resetAllUnread()}
                    >
                        Reset
                    </button>
                </div>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Delete all data</span>
                        <span class="desktop-row__desc">
                            Deletes local history, sessions, keys, and saved
                            credentials for this account.
                        </span>
                    </div>
                    {#if confirmDeleteAll}
                        <div class="desktop-actions">
                            <button
                                class="desktop-button desktop-button--danger"
                                onclick={() => void handleDeleteAllData()}
                            >
                                Delete everything
                            </button>
                            <button
                                class="desktop-button"
                                onclick={() => {
                                    confirmDeleteAll = false;
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    {:else}
                        <button
                            class="desktop-button desktop-button--danger"
                            onclick={() => {
                                confirmDeleteAll = true;
                            }}
                        >
                            Delete all data
                        </button>
                    {/if}
                </div>
            </section>
        {/if}

        {#if section === "developer"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">Connection</h2>
                <div class="desktop-row desktop-row--column">
                    <label class="desktop-row__label" for="server-url">
                        Server URL
                    </label>
                    <span class="desktop-row__desc">
                        The Vex server this desktop client connects to.
                    </span>
                    <div class="desktop-input-row">
                        <input
                            id="server-url"
                            type="url"
                            bind:value={serverUrl}
                            placeholder="api.vex.wtf"
                        />
                        <button
                            class="desktop-button"
                            onclick={saveServerUrl}
                            disabled={!serverUrl.trim()}
                        >
                            {serverUrlSaved ? "Saved" : "Save"}
                        </button>
                    </div>
                </div>
            </section>

            <section class="desktop-section">
                <h2 class="desktop-section__title">WebSocket debug</h2>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Debug logs</span>
                        <span class="desktop-row__desc">
                            Print inbound and outbound frame summaries.
                        </span>
                    </div>
                    <button
                        class="desktop-button {wsDebugEnabled
                            ? 'desktop-button--primary'
                            : ''}"
                        onclick={() => {
                            wsDebugEnabled = !wsDebugEnabled;
                            vexService.setWebsocketDebug(wsDebugEnabled);
                        }}
                    >
                        {wsDebugEnabled ? "On" : "Off"}
                    </button>
                </div>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label"
                            >Frame payload logs</span
                        >
                        <span class="desktop-row__desc">
                            Print raw frame payloads.
                        </span>
                    </div>
                    <button
                        class="desktop-button {wsFrameDebugEnabled
                            ? 'desktop-button--primary'
                            : ''}"
                        onclick={() => {
                            wsFrameDebugEnabled = !wsFrameDebugEnabled;
                            vexService.setWebsocketFrameDebug(
                                wsFrameDebugEnabled,
                            );
                        }}
                    >
                        {wsFrameDebugEnabled ? "On" : "Off"}
                    </button>
                </div>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label"
                            >State transition logs</span
                        >
                        <span class="desktop-row__desc">
                            Print connect, disconnect, and recovery lifecycle.
                        </span>
                    </div>
                    <button
                        class="desktop-button {wsStateDebugEnabled
                            ? 'desktop-button--primary'
                            : ''}"
                        onclick={() => {
                            wsStateDebugEnabled = !wsStateDebugEnabled;
                            vexService.setWebsocketStateDebug(
                                wsStateDebugEnabled,
                            );
                        }}
                    >
                        {wsStateDebugEnabled ? "On" : "Off"}
                    </button>
                </div>
            </section>
        {/if}

        {#if section === "about"}
            <section class="desktop-section">
                <h2 class="desktop-section__title">App</h2>
                <div class="desktop-row">
                    <span class="desktop-row__label">Version</span>
                    <span class="desktop-value desktop-mono">0.1.0</span>
                </div>
                <div class="desktop-row">
                    <div class="desktop-row__info">
                        <span class="desktop-row__label">Software update</span>
                        <span class="desktop-row__desc">
                            {updateStatus.readyToInstall
                                ? "Update is ready to install."
                                : updateStatus.available
                                  ? `Version ${updateStatus.version} available.`
                                  : updateStatus.error
                                    ? updateStatus.error
                                    : "Check for a desktop update."}
                        </span>
                    </div>
                    {#if updateStatus.readyToInstall}
                        <button
                            class="desktop-button desktop-button--primary"
                            onclick={applyUpdate}
                        >
                            Restart to update
                        </button>
                    {:else if updateStatus.downloading}
                        <span class="desktop-value">
                            Downloading {Math.round(
                                updateStatus.progress * 100,
                            )}%
                        </span>
                    {:else}
                        <button
                            class="desktop-button"
                            onclick={() => void handleCheckUpdate()}
                            disabled={checking}
                        >
                            {checking ? "Checking..." : "Check for updates"}
                        </button>
                    {/if}
                </div>
                <div class="desktop-row">
                    <span class="desktop-row__label">Homeserver</span>
                    <span class="desktop-value desktop-mono"
                        >{getServerUrl()}</span
                    >
                </div>
            </section>
        {/if}
    </main>
</div>

<style>
    .settings-link {
        width: 100%;
        color: inherit;
        text-align: left;
        background: transparent;
    }

    .settings-link:hover {
        background: var(--bg-hover);
    }

    .settings-link__chevron {
        color: var(--text-muted);
        font-size: 22px;
        line-height: 1;
    }
</style>
