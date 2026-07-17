<script lang="ts">
    import type { Device, StoredCredentials } from "@vex-chat/libvex";
    import type { DeviceApprovalRequest } from "@vex-chat/store";

    import { onMount } from "svelte";
    import { push, querystring } from "svelte-spa-router";

    import {
        ArrowLeft,
        BellRing,
        ChevronRight,
        CircleUserRound,
        ExternalLink,
        HardDrive,
        KeyRound,
        LockKeyhole,
        Network,
        Palette,
        Settings2,
        ShieldCheck,
    } from "@lucide/svelte";

    import Avatar from "../lib/Avatar.svelte";
    import { clearSession, getServerUrl } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import {
        getNotificationPermissionState,
        getNotificationsEnabled,
        openNotificationSettings,
        requestNotificationAccess,
        sendTestNotification,
        setNotificationsEnabled,
    } from "../lib/notifications.js";
    import {
        getSoundsEnabled,
        playNotify,
        setSoundsEnabled,
    } from "../lib/sounds.js";
    import { avatarHash, user, vexService } from "../lib/store/index.js";
    import {
        applyUpdate,
        checkForUpdates,
        type UpdateStatus,
    } from "../lib/updater.js";

    type SettingsTab = "account" | "data" | "devices" | "general";

    let settingsTab: SettingsTab = $state("general");

    $effect(() => {
        const tab = new URLSearchParams($querystring ?? "").get("tab");
        if (
            tab === "account" ||
            tab === "data" ||
            tab === "devices" ||
            tab === "general"
        ) {
            settingsTab = tab;
        }
    });

    function selectTab(tab: SettingsTab): void {
        settingsTab = tab;
        void push(`/settings?tab=${tab}`);
    }

    // ── Devices ────────────────────────────────────────────────────────────────

    let devices: Device[] = $state([]);
    let devicesLoading = $state(false);
    let devicesError = $state("");
    let deleteConfirmID: null | string = $state(null);
    let deleteError = $state("");

    async function loadDevices(): Promise<void> {
        devicesLoading = true;
        devicesError = "";
        try {
            devices = await vexService.listMyDevices();
        } catch (err: unknown) {
            devicesError =
                err instanceof Error ? err.message : "Could not load devices.";
        } finally {
            devicesLoading = false;
        }
    }

    async function handleDeleteDevice(deviceID: string): Promise<void> {
        deleteError = "";
        const result = await vexService.removeDevice(deviceID);
        if (!result.ok) {
            deleteError = result.error ?? "Could not remove device.";
            return;
        }
        deleteConfirmID = null;
        await loadDevices();
    }

    // ── Pending device approvals ─────────────────────────────────────────────

    let deviceRequests: DeviceApprovalRequest[] = $state([]);
    let deviceRequestsLoading = $state(false);
    let deviceRequestsError = $state("");
    let deviceRequestBusy: Record<string, boolean> = $state({});

    async function loadDeviceRequests(): Promise<void> {
        deviceRequestsLoading = true;
        deviceRequestsError = "";
        try {
            const requests = await vexService.listPendingDeviceRequests();
            deviceRequests = requests.filter(
                (request) => request.status === "pending",
            );
        } catch (err: unknown) {
            deviceRequestsError =
                err instanceof Error
                    ? err.message
                    : "Could not load device requests.";
        } finally {
            deviceRequestsLoading = false;
        }
    }

    async function handleDeviceRequest(
        requestID: string,
        action: "approve" | "reject",
    ): Promise<void> {
        deviceRequestBusy = { ...deviceRequestBusy, [requestID]: true };
        deviceRequestsError = "";
        try {
            const result =
                action === "approve"
                    ? await vexService.approveDeviceRequest(requestID)
                    : await vexService.rejectDeviceRequest(requestID);
            if (!result.ok) {
                deviceRequestsError =
                    result.error ?? `Could not ${action} device request.`;
                return;
            }
            await Promise.all([loadDeviceRequests(), loadDevices()]);
        } finally {
            deviceRequestBusy = {
                ...deviceRequestBusy,
                [requestID]: false,
            };
        }
    }

    function matchingCode(signKey: string): string {
        return signKey.slice(0, 4).toUpperCase();
    }

    onMount(() => {
        void Promise.all([loadDevices(), loadDeviceRequests()]);
        return vexService.onDeviceRequestQueueChanged(() => {
            void loadDeviceRequests();
        });
    });

    // ── Sounds ──────────────────────────────────────────────────────────────────

    let soundsEnabled = $state(getSoundsEnabled());

    function toggleSounds(): void {
        soundsEnabled = !soundsEnabled;
        setSoundsEnabled(soundsEnabled);
        if (soundsEnabled) playNotify();
    }

    // ── Notifications ────────────────────────────────────────────────────────────

    let notificationsEnabled = $state(getNotificationsEnabled());
    let notificationsBusy = $state(false);
    let notificationsError = $state("");
    let notificationsNotice = $state("");
    let notificationSettingsRequired = $state(false);

    async function refreshNotificationPermission(): Promise<void> {
        try {
            const wasSettingsRequired = notificationSettingsRequired;
            const state = await getNotificationPermissionState();
            notificationSettingsRequired = state === "denied";
            if (state === "denied") {
                notificationsEnabled = false;
                setNotificationsEnabled(false);
            } else if (state === "granted" && wasSettingsRequired) {
                notificationsEnabled = true;
                setNotificationsEnabled(true);
                notificationsError = "";
                notificationsNotice = "Notifications are allowed.";
            }
        } catch (error) {
            console.error("Could not refresh notification permission", error);
        }
    }

    onMount(() => {
        const handleFocus = (): void => {
            void refreshNotificationPermission();
        };
        window.addEventListener("focus", handleFocus);
        void refreshNotificationPermission();
        return () => window.removeEventListener("focus", handleFocus);
    });

    async function toggleNotifications(): Promise<void> {
        notificationsError = "";
        notificationsNotice = "";
        if (notificationsEnabled) {
            notificationsEnabled = false;
            setNotificationsEnabled(false);
            return;
        }

        notificationsBusy = true;
        const granted = await requestNotificationAccess();
        notificationsBusy = false;
        notificationsEnabled = granted;
        setNotificationsEnabled(granted);
        if (!granted) {
            notificationsError = "macOS did not allow notifications for Vex.";
            await refreshNotificationPermission();
        }
    }

    async function testNotifications(): Promise<void> {
        notificationsBusy = true;
        notificationsError = "";
        notificationsNotice = "";
        const result = await sendTestNotification();
        notificationsBusy = false;
        if (!result.ok) {
            notificationsEnabled = false;
            setNotificationsEnabled(false);
            notificationSettingsRequired = result.settingsRequired ?? false;
            notificationsError =
                result.error ?? "macOS could not deliver the notification.";
            return;
        }
        notificationsEnabled = true;
        setNotificationsEnabled(true);
        notificationsNotice = "Test notification sent.";
    }

    async function showNotificationSettings(): Promise<void> {
        notificationsError = "";
        try {
            await openNotificationSettings();
        } catch (error) {
            notificationsError =
                error instanceof Error
                    ? error.message
                    : "Could not open macOS System Settings.";
        }
    }

    // ── Server URL ──────────────────────────────────────────────────────────────

    const serverUrl = getServerUrl();

    // ── Account info ────────────────────────────────────────────────────────────

    let creds: null | StoredCredentials = $state(null);
    let fingerprint = $derived.by(() => {
        const key = creds?.deviceKey;
        return key ? key.slice(0, 16).toUpperCase() : "N/A";
    });

    // Load credentials from KeyStore on mount
    void keyStore.loadActive().then((c) => {
        creds = c;
    });

    // ── Avatar upload ────────────────────────────────────────────────────────────

    let avatarInput: HTMLInputElement | undefined = $state();
    let avatarError = $state("");
    let avatarUploading = $state(false);

    async function handleAvatarChange(e: Event): Promise<void> {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            avatarError = "Image must be under 5 MB";
            return;
        }

        const userID = $user?.userID;
        if (!userID) {
            avatarError = "Not authenticated";
            return;
        }

        avatarError = "";
        avatarUploading = true;
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            const result = await vexService.setAvatar(data);
            if (!result.ok) throw new Error(result.error ?? "Upload failed");
        } catch (err: unknown) {
            avatarError = err instanceof Error ? err.message : "Upload failed";
        } finally {
            avatarUploading = false;
            if (avatarInput) avatarInput.value = "";
        }
    }

    // ── Updates ────────────────────────────────────────────────────────────────

    let updateStatus: UpdateStatus = $state({
        available: false,
        downloading: false,
        progress: 0,
        readyToInstall: false,
    });
    let checking = $state(false);

    async function handleCheckUpdate(): Promise<void> {
        checking = true;
        await checkForUpdates((s) => {
            updateStatus = s;
        });
        checking = false;
    }

    // ── Danger zone ─────────────────────────────────────────────────────────────

    let confirmDeleteAll = $state(false);

    async function handleLogout(): Promise<void> {
        try {
            await vexService.logout();
        } catch {
            /* ignore */
        }
        // Clear the stored JWT so auto-login won't fire, but keep device keys
        if (creds) await keyStore.save({ ...creds, token: undefined });
        await keyStore.deactivate();
        clearSession();
        void push("/login");
    }

    async function handleDeleteAllData(): Promise<void> {
        try {
            await vexService.deleteAllData();
        } catch {
            /* ignore */
        }
        if (creds?.username) {
            try {
                await keyStore.clear(creds.username);
            } catch {
                /* ignore */
            }
        }
        clearSession();
        confirmDeleteAll = false;
        window.location.href = "/";
    }
</script>

<div class="settings-page">
    <header class="settings-page__header">
        <button
            class="settings-page__back"
            onclick={() => {
                if (window.history.length > 1) history.back();
                else void push("/home");
            }}
            aria-label="Go back"><ArrowLeft size={19} /></button
        >
        <h1 class="settings-page__title">Settings</h1>
    </header>

    <div class="settings-page__layout">
        <nav class="settings-nav" aria-label="Settings sections">
            <button
                class:settings-nav__item--active={settingsTab === "general"}
                class="settings-nav__item"
                onclick={() => selectTab("general")}
            >
                <Settings2 size={17} />
                General
            </button>
            <button
                class:settings-nav__item--active={settingsTab === "account"}
                class="settings-nav__item"
                onclick={() => selectTab("account")}
            >
                <CircleUserRound size={17} />
                Account
            </button>
            <button
                class:settings-nav__item--active={settingsTab === "devices"}
                class="settings-nav__item"
                onclick={() => selectTab("devices")}
            >
                <ShieldCheck size={17} />
                Devices
            </button>
            <button
                class:settings-nav__item--active={settingsTab === "data"}
                class="settings-nav__item"
                onclick={() => selectTab("data")}
            >
                <HardDrive size={17} />
                Data
            </button>
        </nav>

        <div class="settings-page__body">
            {#if settingsTab === "general"}
                <!-- ── Appearance ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Appearance</h2>
                    <button
                        class="settings-link-row"
                        type="button"
                        onclick={() => void push("/settings/appearance")}
                    >
                        <span class="settings-link-row__icon">
                            <Palette size={18} strokeWidth={1.8} />
                        </span>
                        <span class="settings-row__info">
                            <span class="settings-row__label"
                                >Theme and primary color</span
                            >
                            <span class="settings-row__desc"
                                >Dark or light mode with your preferred accent</span
                            >
                        </span>
                        <ChevronRight
                            class="settings-link-row__chevron"
                            size={17}
                        />
                    </button>
                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >Sound effects</span
                            >
                            <span class="settings-row__desc"
                                >Play sounds for login, logout, errors, and
                                notifications</span
                            >
                        </div>
                        <button
                            class="settings-btn settings-btn--toggle {soundsEnabled
                                ? 'settings-btn--toggle-on'
                                : ''}"
                            onclick={toggleSounds}
                        >
                            {soundsEnabled ? "On" : "Off"}
                        </button>
                    </div>
                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >Desktop notifications</span
                            >
                            <span class="settings-row__desc"
                                >Show OS alerts for incoming messages when the
                                window is not focused</span
                            >
                            {#if notificationsError}
                                <span
                                    class="settings-row__desc settings-row__desc--error"
                                    >{notificationsError}</span
                                >
                            {:else if notificationsNotice}
                                <span
                                    class="settings-row__desc settings-row__desc--success"
                                    >{notificationsNotice}</span
                                >
                            {/if}
                        </div>
                        <div class="settings-row__actions">
                            {#if notificationSettingsRequired}
                                <button
                                    class="settings-btn settings-btn--icon-text"
                                    type="button"
                                    onclick={showNotificationSettings}
                                >
                                    <ExternalLink size={14} />
                                    Open Settings
                                </button>
                            {/if}
                            <button
                                class="settings-btn settings-btn--icon-text"
                                type="button"
                                onclick={testNotifications}
                                disabled={notificationsBusy}
                            >
                                <BellRing size={14} />
                                Test
                            </button>
                            <button
                                class="settings-btn settings-btn--toggle {notificationsEnabled
                                    ? 'settings-btn--toggle-on'
                                    : ''}"
                                type="button"
                                onclick={toggleNotifications}
                                disabled={notificationsBusy}
                            >
                                {notificationsEnabled ? "On" : "Off"}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- ── Connection ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Connection</h2>
                    <button
                        class="settings-link-row"
                        type="button"
                        onclick={() => void push("/settings/connection")}
                    >
                        <span class="settings-link-row__icon">
                            <Network size={18} strokeWidth={1.8} />
                        </span>
                        <span class="settings-row__info">
                            <span class="settings-row__label">Homeserver</span>
                            <span class="settings-row__desc">{serverUrl}</span>
                        </span>
                        <ChevronRight
                            class="settings-link-row__chevron"
                            size={17}
                        />
                    </button>
                </section>

                <!-- ── Updates ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Updates</h2>
                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >Current version</span
                            >
                            <span class="settings-row__desc">v0.1.0</span>
                        </div>
                        {#if updateStatus.readyToInstall}
                            <button
                                class="settings-btn settings-btn--toggle-on"
                                onclick={applyUpdate}
                            >
                                Restart to update
                            </button>
                        {:else if updateStatus.downloading}
                            <span class="settings-row__value"
                                >Downloading… {Math.round(
                                    updateStatus.progress * 100,
                                )}%</span
                            >
                        {:else if updateStatus.available}
                            <span class="settings-row__value"
                                >v{updateStatus.version} available</span
                            >
                        {:else if updateStatus.error}
                            <span
                                class="settings-row__desc settings-row__desc--error"
                                >{updateStatus.error}</span
                            >
                        {:else}
                            <button
                                class="settings-btn"
                                onclick={handleCheckUpdate}
                                disabled={checking}
                            >
                                {checking ? "Checking…" : "Check for updates"}
                            </button>
                        {/if}
                    </div>
                </section>
            {:else if settingsTab === "account"}
                <!-- ── Account ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Account</h2>
                    <div class="settings-row">
                        <span class="settings-row__label">Username</span>
                        <span class="settings-row__value"
                            >{$user?.username ?? creds?.username ?? "—"}</span
                        >
                    </div>
                    <div class="settings-row">
                        <span class="settings-row__label">User ID</span>
                        <span
                            class="settings-row__value settings-row__value--mono"
                            >{$user?.userID.slice(0, 8) ?? "—"}…</span
                        >
                    </div>
                    <div class="settings-row">
                        <span class="settings-row__label"
                            >Device fingerprint</span
                        >
                        <span
                            class="settings-row__value settings-row__value--mono"
                            >{fingerprint}…</span
                        >
                    </div>
                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label">Avatar</span>
                            {#if avatarError}
                                <span
                                    class="settings-row__desc settings-row__desc--error"
                                    >{avatarError}</span
                                >
                            {:else}
                                <span class="settings-row__desc"
                                    >Upload a profile picture (JPG, PNG, GIF, or
                                    WebP, max 5 MB)</span
                                >
                            {/if}
                        </div>
                        <div class="settings-avatar-actions">
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
                                class="settings-btn"
                                onclick={() => avatarInput?.click()}
                                disabled={avatarUploading}
                            >
                                {avatarUploading ? "Uploading…" : "Change"}
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
                </section>

                <!-- ── Security ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Security</h2>
                    <button
                        class="settings-link-row"
                        type="button"
                        onclick={() => void push("/settings/password")}
                    >
                        <span class="settings-link-row__icon">
                            <LockKeyhole size={18} strokeWidth={1.8} />
                        </span>
                        <span class="settings-row__info">
                            <span class="settings-row__label">Password</span>
                            <span class="settings-row__desc"
                                >Change your primary sign-in password</span
                            >
                        </span>
                        <ChevronRight
                            class="settings-link-row__chevron"
                            size={17}
                        />
                    </button>
                    <button
                        class="settings-link-row"
                        type="button"
                        onclick={() => void push("/settings/passkeys")}
                    >
                        <span class="settings-link-row__icon">
                            <KeyRound size={18} strokeWidth={1.8} />
                        </span>
                        <span class="settings-row__info">
                            <span class="settings-row__label">Passkeys</span>
                            <span class="settings-row__desc"
                                >Add or remove optional sign-in methods</span
                            >
                        </span>
                        <ChevronRight
                            class="settings-link-row__chevron"
                            size={17}
                        />
                    </button>
                </section>
            {:else if settingsTab === "devices"}
                <!-- ── Device approvals ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Device Requests</h2>
                    {#if deviceRequestsLoading && deviceRequests.length === 0}
                        <div class="settings-row">
                            <span class="settings-row__desc"
                                >Checking for requests…</span
                            >
                        </div>
                    {:else if deviceRequests.length === 0}
                        <div class="settings-row">
                            <div class="settings-row__info">
                                <span class="settings-row__label"
                                    >No pending requests</span
                                >
                                <span class="settings-row__desc"
                                    >New devices appear here after they verify
                                    your password or passkey.</span
                                >
                            </div>
                            <button
                                class="settings-btn"
                                onclick={loadDeviceRequests}>Refresh</button
                            >
                        </div>
                    {:else}
                        {#each deviceRequests as request (request.requestID)}
                            <div
                                class="settings-row settings-row--device-request"
                            >
                                <div class="settings-row__info">
                                    <span class="settings-row__label"
                                        >{request.deviceName ||
                                            "New device"}</span
                                    >
                                    <span class="settings-row__desc"
                                        >Only approve if this code matches the
                                        new device.</span
                                    >
                                    <span class="device-code"
                                        >{matchingCode(request.signKey)}</span
                                    >
                                </div>
                                <div class="settings-confirm">
                                    <button
                                        class="settings-btn settings-btn--danger"
                                        onclick={() =>
                                            handleDeviceRequest(
                                                request.requestID,
                                                "reject",
                                            )}
                                        disabled={deviceRequestBusy[
                                            request.requestID
                                        ]}>Reject</button
                                    >
                                    <button
                                        class="settings-btn settings-btn--primary"
                                        onclick={() =>
                                            handleDeviceRequest(
                                                request.requestID,
                                                "approve",
                                            )}
                                        disabled={deviceRequestBusy[
                                            request.requestID
                                        ]}
                                    >
                                        {deviceRequestBusy[request.requestID]
                                            ? "Working…"
                                            : "Approve"}
                                    </button>
                                </div>
                            </div>
                        {/each}
                    {/if}
                    {#if deviceRequestsError}
                        <div class="settings-row">
                            <span
                                class="settings-row__desc settings-row__desc--error"
                                >{deviceRequestsError}</span
                            >
                        </div>
                    {/if}
                </section>

                <!-- ── Devices ── -->
                <section class="settings-section">
                    <h2 class="settings-section__title">Devices</h2>
                    {#if devicesLoading}
                        <div class="settings-row">
                            <span class="settings-row__desc"
                                >Loading devices…</span
                            >
                        </div>
                    {:else if devicesError}
                        <div class="settings-row">
                            <span
                                class="settings-row__desc settings-row__desc--error"
                                >{devicesError}</span
                            >
                            <button class="settings-btn" onclick={loadDevices}
                                >Retry</button
                            >
                        </div>
                    {:else}
                        {#each devices as device (device.deviceID)}
                            {@const isCurrent =
                                creds?.deviceID === device.deviceID}
                            <div class="settings-row settings-row--device">
                                <div class="settings-row__info">
                                    <span class="settings-row__label">
                                        {device.name || "Unnamed device"}
                                        {#if isCurrent}
                                            <span class="device-badge"
                                                >current</span
                                            >
                                        {/if}
                                    </span>
                                    <span
                                        class="settings-row__desc settings-row__value--mono"
                                    >
                                        {device.signKey.slice(0, 16)}…
                                    </span>
                                    <span class="settings-row__desc">
                                        {device.lastLogin
                                            ? `Last login: ${new Date(device.lastLogin).toLocaleString()}`
                                            : "Never logged in"}
                                    </span>
                                </div>
                                {#if !isCurrent}
                                    {#if deleteConfirmID === device.deviceID}
                                        <div class="settings-confirm">
                                            <span class="settings-confirm__msg"
                                                >Delete?</span
                                            >
                                            <button
                                                class="settings-btn settings-btn--danger"
                                                onclick={() =>
                                                    handleDeleteDevice(
                                                        device.deviceID,
                                                    )}>Yes</button
                                            >
                                            <button
                                                class="settings-btn"
                                                onclick={() => {
                                                    deleteConfirmID = null;
                                                    deleteError = "";
                                                }}>No</button
                                            >
                                        </div>
                                    {:else}
                                        <button
                                            class="settings-btn settings-btn--danger"
                                            onclick={() => {
                                                deleteConfirmID =
                                                    device.deviceID;
                                                deleteError = "";
                                            }}
                                            disabled={devices.length <= 1}
                                            title={devices.length <= 1
                                                ? "Cannot delete your last device"
                                                : "Remove this device"}
                                        >
                                            Delete
                                        </button>
                                    {/if}
                                {/if}
                            </div>
                        {/each}
                        {#if deleteError}
                            <div class="settings-row">
                                <span
                                    class="settings-row__desc settings-row__desc--error"
                                    >{deleteError}</span
                                >
                            </div>
                        {/if}
                    {/if}
                </section>
            {:else}
                <!-- ── Danger zone ── -->
                <section class="settings-section settings-section--danger">
                    <h2 class="settings-section__title">Danger Zone</h2>

                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label">Sign out</span>
                            <span class="settings-row__desc"
                                >Disconnect and return to the login screen</span
                            >
                        </div>
                        <button
                            class="settings-btn settings-btn--danger"
                            onclick={handleLogout}>Sign out</button
                        >
                    </div>

                    <div class="settings-row">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >Delete all data</span
                            >
                            <span class="settings-row__desc"
                                >Delete message history, encryption sessions,
                                device keys, and credentials from this device.
                                The app will restart fresh.</span
                            >
                        </div>
                        {#if confirmDeleteAll}
                            <div class="settings-confirm">
                                <span class="settings-confirm__msg"
                                    >This cannot be undone.</span
                                >
                                <button
                                    class="settings-btn settings-btn--danger"
                                    onclick={handleDeleteAllData}
                                    >Delete everything</button
                                >
                                <button
                                    class="settings-btn"
                                    onclick={() => {
                                        confirmDeleteAll = false;
                                    }}>Cancel</button
                                >
                            </div>
                        {:else}
                            <button
                                class="settings-btn settings-btn--danger"
                                onclick={() => {
                                    confirmDeleteAll = true;
                                }}>Delete all data</button
                            >
                        {/if}
                    </div>
                </section>
            {/if}
        </div>
    </div>
</div>

<style>
    .settings-page {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
    }

    .settings-page__header {
        height: var(--topbar-height);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 18px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        background: var(--bg-secondary);
    }

    .settings-page__back {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        color: var(--text-muted);
    }

    .settings-page__back:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .settings-page__title {
        font-family: var(--font-heading);
        font-size: 17px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .settings-page__layout {
        min-height: 0;
        flex: 1;
        display: flex;
        overflow: hidden;
    }

    .settings-nav {
        width: 184px;
        flex: 0 0 184px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px 10px;
        border-right: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .settings-nav__item {
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 10px;
        border-radius: 6px;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 600;
        text-align: left;
    }

    .settings-nav__item:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .settings-nav__item--active {
        background: var(--accent-soft);
        color: var(--text-primary);
    }

    .settings-page__body {
        min-height: 0;
        min-width: 0;
        flex: 1;
        overflow-y: auto;
        padding: 28px 32px 44px;
        display: flex;
        flex-direction: column;
        gap: 32px;
    }

    .settings-section {
        width: min(720px, 100%);
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--border);
    }

    .settings-section--danger {
        border-top-color: color-mix(in srgb, var(--danger) 42%, var(--border));
    }

    .settings-section__title {
        padding: 16px 0 9px;
        color: var(--text-primary);
        font-family: var(--font-heading);
        font-size: 18px;
        font-weight: 700;
    }

    .settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 58px;
        padding: 13px 0;
        gap: 12px;
        border-bottom: 1px solid var(--border);
    }

    .settings-row:last-child {
        border-bottom: none;
    }

    .settings-row__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .settings-row__label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .settings-row__desc {
        font-size: 12px;
        color: var(--text-muted);
    }

    .settings-row__value {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .settings-row__value--mono {
        font-family: monospace;
        font-size: 12px;
    }

    .settings-btn {
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        background: var(--bg-surface);
        color: var(--text-primary);
        border: 1px solid var(--border);
        flex-shrink: 0;
    }

    .settings-btn:hover:not(:disabled) {
        background: var(--bg-hover);
    }

    .settings-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .settings-btn--toggle {
        min-width: 48px;
    }

    .settings-btn--icon-text,
    .settings-row__actions {
        display: flex;
        align-items: center;
    }

    .settings-btn--icon-text {
        gap: 6px;
    }

    .settings-row__actions {
        gap: 8px;
        flex-shrink: 0;
    }

    .settings-btn--toggle-on {
        background: var(--accent);
        color: var(--on-accent);
        border-color: var(--accent);
    }

    .settings-btn--primary {
        background: var(--accent);
        color: var(--on-accent);
        border-color: var(--accent);
    }

    .settings-btn--primary:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .settings-btn--danger {
        background: transparent;
        color: var(--danger);
        border-color: color-mix(in srgb, var(--danger) 50%, transparent);
    }

    .settings-btn--danger:hover:not(:disabled) {
        background: var(--danger);
        color: #fff;
    }

    .settings-row__desc--error {
        color: var(--danger);
    }

    .settings-row__desc--success {
        color: var(--success);
    }

    .settings-link-row {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: 64px;
        gap: 11px;
        padding: 11px 2px;
        border: 0;
        border-bottom: 1px solid var(--border);
        border-radius: 0;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        text-align: left;
    }

    .settings-link-row:last-child {
        border-bottom: 0;
    }

    .settings-link-row:hover {
        background: var(--bg-hover);
    }

    .settings-link-row:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: -2px;
    }

    .settings-link-row__icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        border-radius: 6px;
        color: var(--text-secondary);
        background: var(--bg-surface);
    }

    :global(.settings-link-row__chevron) {
        flex: 0 0 auto;
        color: var(--text-faint);
    }

    .settings-avatar-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .settings-confirm {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .settings-confirm__msg {
        font-size: 13px;
        color: var(--danger);
        font-weight: 600;
    }

    .device-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        padding: 1px 6px;
        margin-left: 6px;
        border-radius: 3px;
        background: var(--accent);
        color: var(--on-accent);
        vertical-align: middle;
    }

    .settings-row--device {
        align-items: flex-start;
    }

    .settings-row--device-request {
        align-items: center;
    }

    .device-code {
        align-self: flex-start;
        margin-top: 6px;
        padding: 5px 9px;
        border: 1px solid var(--accent);
        border-radius: 4px;
        color: var(--text-primary);
        background: color-mix(in srgb, var(--accent) 10%, transparent);
        font-family: monospace;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0;
    }

    @media (max-width: 700px) {
        .settings-page__layout {
            flex-direction: column;
        }

        .settings-nav {
            width: 100%;
            flex: 0 0 auto;
            flex-direction: row;
            overflow-x: auto;
            padding: 8px 10px;
            border-right: 0;
            border-bottom: 1px solid var(--border);
        }

        .settings-nav__item {
            flex: 0 0 auto;
        }

        .settings-page__body {
            padding: 16px;
        }

        .settings-row--device-request {
            align-items: stretch;
            flex-direction: column;
        }

        .settings-row__actions {
            align-self: flex-end;
        }

        .settings-confirm {
            flex-wrap: wrap;
        }
    }
</style>
