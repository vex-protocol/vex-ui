<script lang="ts">
    import type { Server } from "@vex-chat/libvex";

    import { vexService } from "./store/index.js";

    let {
        server,
        size = 40,
    }: {
        server: Server;
        size?: number;
    } = $props();

    let failedIconID = $state("");
    const iconURL = $derived(
        server.icon && failedIconID !== server.icon
            ? vexService.getServerIconURL(server.icon)
            : "",
    );
    const initials = $derived(
        server.name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] ?? "")
            .join("")
            .toUpperCase() || "?",
    );
</script>

<span
    class="server-icon"
    style={`--server-icon-size:${String(size)}px`}
    title={server.name}
>
    {#if iconURL}
        <img
            class="server-icon__image"
            src={iconURL}
            alt=""
            onerror={() => {
                failedIconID = server.icon ?? "";
            }}
        />
    {:else}
        <span class="server-icon__initials" aria-hidden="true">
            {initials}
        </span>
    {/if}
</span>

<style>
    .server-icon {
        width: var(--server-icon-size);
        height: var(--server-icon-size);
        flex: 0 0 var(--server-icon-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: calc(var(--server-icon-size) * 0.28);
        background: var(--bg-elevated);
        color: var(--text-secondary);
    }

    .server-icon__image {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }

    .server-icon__initials {
        font-family: var(--font-heading);
        font-size: max(10px, calc(var(--server-icon-size) * 0.32));
        font-weight: 700;
        letter-spacing: 0.02em;
        line-height: 1;
    }
</style>
