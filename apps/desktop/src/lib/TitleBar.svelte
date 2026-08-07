<script lang="ts">
    import { getCurrentWindow } from "@tauri-apps/api/window";

    const win = getCurrentWindow();

    async function minimize() {
        await win.minimize();
    }
    async function toggleMaximize() {
        await win.toggleMaximize();
    }
    async function close() {
        await win.close();
    }
</script>

<div class="titlebar" data-tauri-drag-region>
    <div class="titlebar__title" data-tauri-drag-region>
        <span class="titlebar__app-name">vex</span>
    </div>

    <div class="titlebar__controls">
        <button
            class="titlebar__btn titlebar__btn--minimize"
            onclick={minimize}
            aria-label="Minimize"
            title="Minimize"
        >
            <span>─</span>
        </button>
        <button
            class="titlebar__btn titlebar__btn--maximize"
            onclick={toggleMaximize}
            aria-label="Maximize"
            title="Maximize"
        >
            <span>□</span>
        </button>
        <button
            class="titlebar__btn titlebar__btn--close"
            onclick={close}
            aria-label="Close"
            title="Close"
        >
            <span>✕</span>
        </button>
    </div>
</div>

<style>
    .titlebar {
        height: var(--titlebar-height);
        background: var(--bg-tertiary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
        user-select: none;
        border-bottom: 1px solid var(--border);
    }

    .titlebar__title {
        flex: 1;
        display: flex;
        align-items: center;
        padding: 0 12px;
        height: 100%;
    }

    .titlebar__app-name {
        font-family: var(--font-heading);
        font-size: 13px;
        font-weight: 700;
        color: var(--accent);
        letter-spacing: 0.02em;
    }

    .titlebar__controls {
        display: flex;
        height: 100%;
    }

    .titlebar__btn {
        width: 46px;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        font-size: 12px;
        transition:
            background 0.15s,
            color 0.15s;
    }

    .titlebar__btn:hover {
        background: var(--bg-surface);
        color: var(--text-primary);
    }

    .titlebar__btn--close:hover {
        background: var(--danger);
        color: #fff;
    }
</style>
