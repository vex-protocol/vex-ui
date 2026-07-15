<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ChevronUp, LogOut, Settings } from "@lucide/svelte";

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
            // Local session cleanup still needs to run if the server is offline.
        }
        const credentials = await keyStore.loadActive();
        if (credentials) {
            await keyStore.save({ ...credentials, token: undefined });
        }
        await keyStore.deactivate();
        clearSession();
        void push("/login");
    }

    function openSettings(): void {
        menuOpen = false;
        void push("/settings");
    }
</script>

<footer class="account-menu">
    <button
        class="account-menu__identity"
        type="button"
        onclick={() => (menuOpen = !menuOpen)}
        aria-label="Open account menu"
        aria-expanded={menuOpen}
    >
        <span class="account-menu__avatar">
            {#if userID}
                <Avatar
                    {userID}
                    serverUrl={getServerUrl()}
                    version={$avatarHash}
                    size={34}
                    name={username}
                />
            {:else}
                <span class="account-menu__placeholder">?</span>
            {/if}
            <span class="account-menu__status"></span>
        </span>
        <span class="account-menu__meta">
            <strong>{username || "Signed out"}</strong>
            <span>Online</span>
        </span>
        <ChevronUp
            class={menuOpen ? "account-menu__chevron--open" : ""}
            size={16}
        />
    </button>

    <button
        class="account-menu__settings"
        type="button"
        onclick={openSettings}
        title="Settings"
        aria-label="Settings"
    >
        <Settings size={18} />
    </button>

    {#if menuOpen}
        <div class="account-menu__popover" role="menu">
            <div class="account-menu__popover-name">
                <strong>{username}</strong>
                <span>Vex account</span>
            </div>
            <button role="menuitem" onclick={openSettings}>
                <Settings size={16} />
                Settings
            </button>
            <div class="account-menu__divider"></div>
            <button
                class="account-menu__danger"
                role="menuitem"
                onclick={() => void logout()}
            >
                <LogOut size={16} />
                Sign out
            </button>
        </div>
    {/if}
</footer>

{#if menuOpen}
    <button
        class="account-menu__backdrop"
        type="button"
        aria-label="Close account menu"
        onclick={() => (menuOpen = false)}
    ></button>
{/if}

<style>
    .account-menu {
        position: relative;
        height: 58px;
        flex: 0 0 58px;
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 7px 8px;
        border-top: 1px solid var(--border);
        background: var(--bg-tertiary);
    }

    .account-menu__identity {
        min-width: 0;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px;
        border-radius: 6px;
        text-align: left;
    }

    .account-menu__identity:hover,
    .account-menu__settings:hover {
        background: var(--bg-hover);
    }

    .account-menu__avatar {
        position: relative;
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
    }

    .account-menu__placeholder {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        font-weight: 700;
    }

    .account-menu__status {
        position: absolute;
        right: -1px;
        bottom: -1px;
        width: 10px;
        height: 10px;
        border: 2px solid var(--bg-tertiary);
        border-radius: 50%;
        background: var(--success);
    }

    .account-menu__meta {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .account-menu__meta strong,
    .account-menu__meta span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .account-menu__meta strong {
        color: var(--text-secondary);
        font-size: 12px;
    }

    .account-menu__meta span {
        color: var(--text-faint);
        font-size: 10px;
    }

    .account-menu__identity :global(svg) {
        flex: 0 0 auto;
        color: var(--text-faint);
        transition: transform 140ms ease;
    }

    .account-menu__identity :global(.account-menu__chevron--open) {
        transform: rotate(180deg);
    }

    .account-menu__settings {
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        color: var(--text-muted);
    }

    .account-menu__popover {
        position: absolute;
        z-index: 110;
        right: 8px;
        bottom: calc(100% + 7px);
        left: 8px;
        padding: 5px;
        border: 1px solid var(--border-strong);
        border-radius: 7px;
        background: var(--bg-elevated);
        box-shadow: var(--shadow-menu);
    }

    .account-menu__popover-name {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 9px 9px;
    }

    .account-menu__popover-name strong {
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .account-menu__popover-name span {
        color: var(--text-faint);
        font-size: 10px;
    }

    .account-menu__popover button {
        width: 100%;
        height: 34px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 8px;
        border-radius: 5px;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        text-align: left;
    }

    .account-menu__popover button:hover {
        background: var(--bg-hover);
    }

    .account-menu__popover .account-menu__danger {
        color: var(--danger);
    }

    .account-menu__divider {
        height: 1px;
        margin: 4px;
        background: var(--border);
    }

    .account-menu__backdrop {
        position: fixed;
        z-index: 109;
        inset: 0;
        width: 100%;
        height: 100%;
        cursor: default;
    }
</style>
