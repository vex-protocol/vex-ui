<script lang="ts">
    import type { User } from "@vex-chat/libvex";

    import { Crown, LoaderCircle, UserMinus } from "@lucide/svelte";

    import Avatar from "./Avatar.svelte";
    import { getServerUrl } from "./config.js";

    let {
        canKick,
        kicking,
        onKick,
        online,
        owner,
        user,
    }: {
        canKick: boolean;
        kicking: boolean;
        onKick: (member: User) => Promise<void>;
        online: boolean;
        owner: boolean;
        user: User;
    } = $props();
</script>

<div class:member--offline={!online} class="member">
    <div class="member__avatar-wrap">
        <Avatar
            userID={user.userID}
            serverUrl={getServerUrl()}
            size={28}
            name={user.username}
        />
        {#if online}
            <span class="member__dot member__dot--online"></span>
        {/if}
    </div>
    <span class="member__name" title={user.username}>
        {user.username}
        {#if owner}
            <span class="member__crown" aria-label="Group owner">
                <Crown size={13} />
            </span>
        {/if}
    </span>
    {#if canKick || kicking}
        <button
            class="member__kick"
            title={`Remove ${user.username}`}
            aria-label={`Remove ${user.username}`}
            disabled={kicking}
            onclick={() => {
                void onKick(user);
            }}
        >
            {#if kicking}
                <span class="member__spinner"><LoaderCircle size={14} /></span>
            {:else}
                <UserMinus size={14} />
            {/if}
        </button>
    {/if}
</div>

<style>
    .member {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px;
        border-radius: 4px;
        transition: background 0.1s;
    }

    .member:hover {
        background: var(--bg-hover);
    }

    .member--offline {
        opacity: 0.5;
    }

    .member__avatar-wrap {
        position: relative;
        flex-shrink: 0;
    }

    .member__dot {
        position: absolute;
        bottom: -1px;
        right: -1px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 2px solid var(--bg-secondary);
    }

    .member__dot--online {
        background: var(--success);
    }

    .member__name {
        font-size: 13px;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .member__crown {
        color: #ffd76a;
        flex-shrink: 0;
    }

    .member__kick {
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255, 122, 122, 0.48);
        border-radius: 4px;
        background: transparent;
        color: var(--danger);
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
    }

    .member__kick:disabled {
        cursor: default;
        opacity: 0.45;
    }

    .member__spinner {
        animation: member-spin 0.8s linear infinite;
    }

    @keyframes member-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
