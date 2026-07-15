<script lang="ts">
    import { push } from "svelte-spa-router";

    import Avatar from "./Avatar.svelte";
    import { clearSession, getServerUrl } from "./config.js";
    import { keyStore } from "./keystore.js";
    import { playLock } from "./sounds.js";
    import { avatarHash, vexService } from "./store/index.js";

    let { userID, username }: { userID?: string; username?: string } = $props();

    let menuOpen = $state(false);

    async function logout(): Promise<void> {
        menuOpen = false;
        playLock();
        try {
            await vexService.logout();
        } catch {
            /* ignore */
        }
        // Clear JWT so auto-login won't fire, but keep device keys
        const creds = await keyStore.loadActive();
        if (creds) await keyStore.save({ ...creds, token: undefined });
        await keyStore.deactivate();
        // VexService.logout() resets all state internally.
        // SQLite storage is per-device-key; no manual clear needed on logout
        clearSession();
        void push("/login");
    }

    function openSettings(): void {
        menuOpen = false;
        void push("/settings");
    }
</script>

<div class="user-menu">
    <div class="user-menu__trigger-row">
        <button
            class="user-menu__trigger"
            onclick={() => (menuOpen = !menuOpen)}
            aria-label="User menu"
            aria-expanded={menuOpen}
        >
            <div class="user-menu__avatar-wrap">
                {#if userID}
                    <Avatar
                        {userID}
                        serverUrl={getServerUrl()}
                        version={$avatarHash}
                        size={32}
                        name={username}
                    />
                {:else}
                    <div class="user-menu__avatar" title={username}>?</div>
                {/if}
                <span class="user-menu__status-dot"></span>
            </div>
            <div class="user-menu__info">
                <span class="user-menu__name"
                    >{username || "Not logged in"}</span
                >
                <span class="user-menu__status-text">online</span>
            </div>
        </button>
        <button
            class="user-menu__gear"
            onclick={openSettings}
            title="Settings"
            aria-label="Settings">⚙</button
        >
    </div>

    {#if menuOpen}
        <div class="user-menu__dropdown" role="menu">
            <button
                class="user-menu__item"
                role="menuitem"
                onclick={openSettings}
            >
                Settings
            </button>
            <div class="user-menu__divider" role="separator"></div>
            <button
                class="user-menu__item user-menu__item--danger"
                role="menuitem"
                onclick={logout}
            >
                Sign out
            </button>
        </div>
    {/if}
</div>

{#if menuOpen}
    <div
        class="user-menu__backdrop"
        role="presentation"
        onclick={() => (menuOpen = false)}
    ></div>
{/if}

<style>
    .user-menu {
        position: relative;
        padding: 8px;
        border-top: 1px solid var(--border);
        background: var(--bg-tertiary);
        flex-shrink: 0;
    }

    .user-menu__trigger-row {
        display: flex;
        align-items: center;
        gap: 0;
    }

    .user-menu__trigger {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px;
        border-radius: 4px;
        transition: background 0.1s;
        min-width: 0;
    }

    .user-menu__trigger:hover {
        background: var(--bg-hover);
    }

    .user-menu__avatar-wrap {
        position: relative;
        flex-shrink: 0;
    }

    .user-menu__avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .user-menu__status-dot {
        position: absolute;
        bottom: -1px;
        right: -1px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--success);
        border: 2px solid var(--bg-tertiary);
    }

    .user-menu__info {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .user-menu__name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.2;
    }

    .user-menu__status-text {
        font-size: 11px;
        color: var(--text-muted);
        text-align: left;
        line-height: 1.2;
    }

    .user-menu__gear {
        width: 28px;
        height: 28px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: var(--text-muted);
        flex-shrink: 0;
        transition:
            background 0.1s,
            color 0.1s;
    }

    .user-menu__gear:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .user-menu__dropdown {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 8px;
        right: 8px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
        z-index: 100;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .user-menu__item {
        width: 100%;
        padding: 8px 12px;
        text-align: left;
        font-size: 13px;
        color: var(--text-primary);
        transition: background 0.1s;
    }

    .user-menu__item:hover {
        background: var(--bg-hover);
    }
    .user-menu__item--danger {
        color: var(--danger);
    }
    .user-menu__item--danger:hover {
        background: var(--danger);
        color: #fff;
    }

    .user-menu__divider {
        height: 1px;
        background: var(--border);
    }

    .user-menu__backdrop {
        position: fixed;
        inset: 0;
        z-index: 99;
    }
</style>
