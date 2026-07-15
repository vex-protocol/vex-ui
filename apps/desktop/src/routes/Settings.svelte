<script lang="ts">
    import type { Device, Passkey, StoredCredentials } from "@vex-chat/libvex";
    import type { DeviceApprovalRequest } from "@vex-chat/store";

    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";

    import Avatar from "../lib/Avatar.svelte";
    import { clearSession, getServerUrl, setServerUrl } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import {
        getNotificationsEnabled,
        setNotificationsEnabled,
    } from "../lib/notifications.js";
    import { registerPasskey } from "../lib/passkey.js";
    import {
        getSoundsEnabled,
        playNotify,
        setSoundsEnabled,
    } from "../lib/sounds.js";
    import { avatarHash, user, vexService } from "../lib/store/index.js";
    import { theme, toggleTheme } from "../lib/stores/theme.js";
    import {
        applyUpdate,
        checkForUpdates,
        type UpdateStatus,
    } from "../lib/updater.js";

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

    // ── Passkeys ─────────────────────────────────────────────────────────────

    let passkeys: Passkey[] = $state([]);
    let passkeysLoading = $state(false);
    let passkeysError = $state("");
    let passkeyName = $state("");
    let passkeyBusy = $state(false);
    let passkeyDeleteConfirmID: null | string = $state(null);

    async function loadPasskeys(): Promise<void> {
        passkeysLoading = true;
        passkeysError = "";
        try {
            passkeys = [...(await vexService.listPasskeys())].sort(
                (a: Passkey, b: Passkey) =>
                    new Date(b.lastUsedAt ?? b.createdAt).getTime() -
                    new Date(a.lastUsedAt ?? a.createdAt).getTime(),
            );
        } catch (err: unknown) {
            passkeysError =
                err instanceof Error ? err.message : "Could not load passkeys.";
        } finally {
            passkeysLoading = false;
        }
    }

    async function handleAddPasskey(): Promise<void> {
        const name = passkeyName.trim();
        if (!name) {
            passkeysError = "Give the passkey a name you will recognize.";
            return;
        }
        passkeyBusy = true;
        passkeysError = "";
        try {
            const begin = await vexService.beginPasskeyRegistration(name);
            const response = await registerPasskey(begin.options);
            const result = await vexService.finishPasskeyRegistration({
                name,
                requestID: begin.requestID,
                response,
            });
            if (!result.ok) {
                passkeysError =
                    result.error ?? "Could not register the passkey.";
                return;
            }
            passkeyName = "";
            await loadPasskeys();
        } catch (err: unknown) {
            passkeysError =
                err instanceof Error
                    ? err.message
                    : "Could not register the passkey.";
        } finally {
            passkeyBusy = false;
        }
    }

    async function handleDeletePasskey(passkeyID: string): Promise<void> {
        passkeysError = "";
        const result = await vexService.deletePasskey(passkeyID);
        if (!result.ok) {
            passkeysError = result.error ?? "Could not remove the passkey.";
            return;
        }
        passkeyDeleteConfirmID = null;
        await loadPasskeys();
    }

    // ── Password ─────────────────────────────────────────────────────────────

    let currentPassword = $state("");
    let newPassword = $state("");
    let confirmPassword = $state("");
    let passwordBusy = $state(false);
    let passwordError = $state("");
    let passwordNotice = $state("");
    let showPasswords = $state(false);

    async function handleChangePassword(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        passwordError = "";
        passwordNotice = "";
        if (!currentPassword) {
            passwordError = "Enter your current password.";
            return;
        }
        if (newPassword.length < 15) {
            passwordError = "Use at least 15 characters for the new password.";
            return;
        }
        if (newPassword.length > 1024) {
            passwordError = "The new password is too long.";
            return;
        }
        if (newPassword !== confirmPassword) {
            passwordError = "New passwords do not match.";
            return;
        }

        passwordBusy = true;
        const result = await vexService.changePassword(
            currentPassword,
            newPassword,
        );
        passwordBusy = false;
        if (!result.ok) {
            passwordError = result.error ?? "Could not change password.";
            return;
        }
        currentPassword = "";
        newPassword = "";
        confirmPassword = "";
        passwordNotice = "Password updated.";
    }

    onMount(() => {
        void Promise.all([loadDevices(), loadDeviceRequests(), loadPasskeys()]);
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

    function toggleNotifications(): void {
        notificationsEnabled = !notificationsEnabled;
        setNotificationsEnabled(notificationsEnabled);
    }

    // ── Server URL ──────────────────────────────────────────────────────────────

    let serverUrl = $state(getServerUrl());
    let serverUrlSaved = $state(false);

    function saveServerUrl(): void {
        setServerUrl(serverUrl.trim());
        serverUrlSaved = true;
        setTimeout(() => {
            serverUrlSaved = false;
        }, 2000);
    }

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
            aria-label="Go back">←</button
        >
        <h1 class="settings-page__title">Settings</h1>
    </header>

    <div class="settings-page__body">
        <!-- ── Appearance ── -->
        <section class="settings-section">
            <h2 class="settings-section__title">Appearance</h2>
            <div class="settings-row">
                <div class="settings-row__info">
                    <span class="settings-row__label">Theme</span>
                    <span class="settings-row__desc"
                        >Toggle between dark and light mode</span
                    >
                </div>
                <button class="settings-btn" onclick={toggleTheme}>
                    {$theme === "dark" ? "Switch to Light" : "Switch to Dark"}
                </button>
            </div>
            <div class="settings-row">
                <div class="settings-row__info">
                    <span class="settings-row__label">Sound effects</span>
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
                        >Show OS alerts for incoming messages when the window is
                        not focused</span
                    >
                </div>
                <button
                    class="settings-btn settings-btn--toggle {notificationsEnabled
                        ? 'settings-btn--toggle-on'
                        : ''}"
                    onclick={toggleNotifications}
                >
                    {notificationsEnabled ? "On" : "Off"}
                </button>
            </div>
        </section>

        <!-- ── Connection ── -->
        <section class="settings-section">
            <h2 class="settings-section__title">Connection</h2>
            <div class="settings-row settings-row--column">
                <label class="settings-row__label" for="server-url"
                    >Server URL</label
                >
                <span class="settings-row__desc"
                    >The Vex Chat server this client connects to</span
                >
                <div class="settings-row__input-row">
                    <input
                        id="server-url"
                        class="settings-input"
                        type="url"
                        bind:value={serverUrl}
                        placeholder="api.vex.wtf"
                    />
                    <button
                        class="settings-btn"
                        onclick={saveServerUrl}
                        disabled={!serverUrl.trim()}
                    >
                        {serverUrlSaved ? "Saved!" : "Save"}
                    </button>
                </div>
            </div>
        </section>

        <!-- ── Updates ── -->
        <section class="settings-section">
            <h2 class="settings-section__title">Updates</h2>
            <div class="settings-row">
                <div class="settings-row__info">
                    <span class="settings-row__label">Current version</span>
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
                    <span class="settings-row__desc settings-row__desc--error"
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
                <span class="settings-row__value settings-row__value--mono"
                    >{$user?.userID.slice(0, 8) ?? "—"}…</span
                >
            </div>
            <div class="settings-row">
                <span class="settings-row__label">Device fingerprint</span>
                <span class="settings-row__value settings-row__value--mono"
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
                            >Upload a profile picture (JPG, PNG, GIF, or WebP,
                            max 5 MB)</span
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

        <!-- ── Password ── -->
        <section class="settings-section">
            <h2 class="settings-section__title">Password</h2>
            <form
                class="settings-row settings-row--column settings-security-form"
                onsubmit={handleChangePassword}
            >
                <span class="settings-row__desc"
                    >Use 15 or more characters. Vex does not require arbitrary
                    symbol or capitalization rules.</span
                >
                <div class="settings-field-grid">
                    <label class="settings-field">
                        <span class="settings-row__label">Current password</span
                        >
                        <input
                            class="settings-input"
                            type={showPasswords ? "text" : "password"}
                            autocomplete="current-password"
                            bind:value={currentPassword}
                            disabled={passwordBusy}
                            required
                        />
                    </label>
                    <label class="settings-field">
                        <span class="settings-row__label">New password</span>
                        <input
                            class="settings-input"
                            type={showPasswords ? "text" : "password"}
                            autocomplete="new-password"
                            minlength={15}
                            maxlength={1024}
                            bind:value={newPassword}
                            disabled={passwordBusy}
                            required
                        />
                    </label>
                    <label class="settings-field">
                        <span class="settings-row__label"
                            >Confirm new password</span
                        >
                        <input
                            class="settings-input"
                            type={showPasswords ? "text" : "password"}
                            autocomplete="new-password"
                            minlength={15}
                            maxlength={1024}
                            bind:value={confirmPassword}
                            disabled={passwordBusy}
                            required
                        />
                    </label>
                </div>
                <div class="settings-form-actions">
                    <label class="settings-check">
                        <input type="checkbox" bind:checked={showPasswords} />
                        <span>Show passwords</span>
                    </label>
                    <button
                        class="settings-btn settings-btn--primary"
                        type="submit"
                        disabled={passwordBusy}
                    >
                        {passwordBusy ? "Updating…" : "Update password"}
                    </button>
                </div>
                {#if passwordError}
                    <span class="settings-row__desc settings-row__desc--error"
                        >{passwordError}</span
                    >
                {:else if passwordNotice}
                    <span class="settings-row__desc settings-row__desc--success"
                        >{passwordNotice}</span
                    >
                {/if}
            </form>
        </section>

        <!-- ── Passkeys ── -->
        <section class="settings-section">
            <h2 class="settings-section__title">Passkeys</h2>
            <div class="settings-row">
                <div class="settings-row__info">
                    <span class="settings-row__label"
                        >Optional sign-in method</span
                    >
                    <span class="settings-row__desc"
                        >Passkeys supplement your password and can also verify a
                        password reset.</span
                    >
                </div>
                <button class="settings-btn" onclick={loadPasskeys}
                    >Refresh</button
                >
            </div>
            {#if passkeysLoading && passkeys.length === 0}
                <div class="settings-row">
                    <span class="settings-row__desc">Loading passkeys…</span>
                </div>
            {:else if passkeys.length === 0}
                <div class="settings-row">
                    <span class="settings-row__desc"
                        >No passkeys added. Your password remains the required
                        account credential.</span
                    >
                </div>
            {:else}
                {#each passkeys as passkey (passkey.passkeyID)}
                    <div class="settings-row settings-row--device">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >{passkey.name}</span
                            >
                            <span class="settings-row__desc">
                                {passkey.lastUsedAt
                                    ? `Last used ${new Date(passkey.lastUsedAt).toLocaleString()}`
                                    : `Added ${new Date(passkey.createdAt).toLocaleString()}`}
                            </span>
                        </div>
                        {#if passkeyDeleteConfirmID === passkey.passkeyID}
                            <div class="settings-confirm">
                                <span class="settings-confirm__msg"
                                    >Remove?</span
                                >
                                <button
                                    class="settings-btn settings-btn--danger"
                                    onclick={() =>
                                        handleDeletePasskey(passkey.passkeyID)}
                                    >Yes</button
                                >
                                <button
                                    class="settings-btn"
                                    onclick={() => {
                                        passkeyDeleteConfirmID = null;
                                    }}>No</button
                                >
                            </div>
                        {:else}
                            <button
                                class="settings-btn settings-btn--danger"
                                onclick={() => {
                                    passkeyDeleteConfirmID = passkey.passkeyID;
                                }}>Remove</button
                            >
                        {/if}
                    </div>
                {/each}
            {/if}
            <div class="settings-row settings-row--column">
                <label class="settings-row__label" for="passkey-name"
                    >Add a passkey</label
                >
                <div class="settings-row__input-row">
                    <input
                        id="passkey-name"
                        class="settings-input"
                        type="text"
                        maxlength={64}
                        bind:value={passkeyName}
                        placeholder="This Mac, security key, etc."
                        disabled={passkeyBusy}
                    />
                    <button
                        class="settings-btn settings-btn--primary"
                        onclick={handleAddPasskey}
                        disabled={passkeyBusy || !passkeyName.trim()}
                    >
                        {passkeyBusy ? "Verifying…" : "Add passkey"}
                    </button>
                </div>
                {#if passkeysError}
                    <span class="settings-row__desc settings-row__desc--error"
                        >{passkeysError}</span
                    >
                {/if}
            </div>
        </section>

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
                            >New devices appear here after they verify your
                            password or passkey.</span
                        >
                    </div>
                    <button class="settings-btn" onclick={loadDeviceRequests}
                        >Refresh</button
                    >
                </div>
            {:else}
                {#each deviceRequests as request (request.requestID)}
                    <div class="settings-row settings-row--device-request">
                        <div class="settings-row__info">
                            <span class="settings-row__label"
                                >{request.deviceName || "New device"}</span
                            >
                            <span class="settings-row__desc"
                                >Only approve if this code matches the new
                                device.</span
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
                                disabled={deviceRequestBusy[request.requestID]}
                                >Reject</button
                            >
                            <button
                                class="settings-btn settings-btn--primary"
                                onclick={() =>
                                    handleDeviceRequest(
                                        request.requestID,
                                        "approve",
                                    )}
                                disabled={deviceRequestBusy[request.requestID]}
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
                    <span class="settings-row__desc settings-row__desc--error"
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
                    <span class="settings-row__desc">Loading devices…</span>
                </div>
            {:else if devicesError}
                <div class="settings-row">
                    <span class="settings-row__desc settings-row__desc--error"
                        >{devicesError}</span
                    >
                    <button class="settings-btn" onclick={loadDevices}
                        >Retry</button
                    >
                </div>
            {:else}
                {#each devices as device (device.deviceID)}
                    {@const isCurrent = creds?.deviceID === device.deviceID}
                    <div class="settings-row settings-row--device">
                        <div class="settings-row__info">
                            <span class="settings-row__label">
                                {device.name || "Unnamed device"}
                                {#if isCurrent}
                                    <span class="device-badge">current</span>
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
                                            handleDeleteDevice(device.deviceID)}
                                        >Yes</button
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
                                        deleteConfirmID = device.deviceID;
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
                    <span class="settings-row__label">Delete all data</span>
                    <span class="settings-row__desc"
                        >Delete message history, encryption sessions, device
                        keys, and credentials from this device. The app will
                        restart fresh.</span
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
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }

    .settings-page__back {
        font-size: 18px;
        color: var(--text-secondary);
        padding: 4px 8px;
        border-radius: 4px;
    }

    .settings-page__back:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .settings-page__title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .settings-page__body {
        flex: 1;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
        overflow-y: auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        max-width: 640px;
    }

    .settings-section {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
    }

    .settings-section--danger {
        border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    }

    .settings-section__title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--text-muted);
        padding: 10px 16px 6px;
        border-bottom: 1px solid var(--border);
    }

    .settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        gap: 12px;
        border-bottom: 1px solid var(--border);
    }

    .settings-row:last-child {
        border-bottom: none;
    }

    .settings-row--column {
        flex-direction: column;
        align-items: flex-start;
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

    .settings-row__input-row {
        display: flex;
        gap: 8px;
        width: 100%;
        margin-top: 6px;
    }

    .settings-input {
        flex: 1;
        padding: 7px 10px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 13px;
        min-width: 0;
    }

    .settings-input:focus {
        outline: none;
        border-color: var(--accent);
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

    .settings-btn--toggle-on {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
    }

    .settings-btn--primary {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
    }

    .settings-btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 82%, white);
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

    .settings-security-form {
        gap: 12px;
    }

    .settings-field-grid {
        display: grid;
        gap: 10px;
        width: 100%;
    }

    .settings-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .settings-form-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
    }

    .settings-check {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--text-secondary);
        font-size: 12px;
    }

    .settings-check input {
        accent-color: var(--accent);
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
        color: #fff;
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
        .settings-page__body {
            padding: 16px;
        }

        .settings-row--device-request,
        .settings-form-actions {
            align-items: stretch;
            flex-direction: column;
        }

        .settings-confirm {
            flex-wrap: wrap;
        }
    }
</style>
