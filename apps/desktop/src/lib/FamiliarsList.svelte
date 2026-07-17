<script lang="ts">
    import type { User } from "@vex-chat/libvex";

    import { location, push } from "svelte-spa-router";

    import { MessageCircle, Search, X } from "@lucide/svelte";

    import Avatar from "./Avatar.svelte";
    import { getServerUrl } from "./config.js";
    import {
        familiars,
        messages,
        dmUnreadCounts as unreadCounts,
        vexService,
    } from "./store/index.js";

    const serverUrl = getServerUrl();
    const familiarList = $derived(
        Object.values($familiars)
            .filter((familiar) => ($messages[familiar.userID]?.length ?? 0) > 0)
            .sort((a, b) => a.username.localeCompare(b.username)),
    );

    let query = $state("");
    let results: User[] = $state([]);
    let searching = $state(false);
    let searchTimer: null | ReturnType<typeof setTimeout> = null;

    function onInput(): void {
        if (searchTimer) clearTimeout(searchTimer);
        const nextQuery = query.trim();
        if (!nextQuery) {
            results = [];
            searching = false;
            return;
        }
        searching = true;
        searchTimer = setTimeout(() => {
            void vexService
                .lookupUser(nextQuery)
                .then((found) => {
                    results = found ? [found] : [];
                })
                .finally(() => {
                    searching = false;
                });
        }, 250);
    }

    function clearSearch(): void {
        query = "";
        results = [];
        searching = false;
    }

    function openDM(target: User): void {
        clearSearch();
        void push(`/messaging/${target.userID}`);
    }

    function isActive(userID: string): boolean {
        return $location === `/messaging/${userID}`;
    }
</script>

<aside class="dm-sidebar" aria-label="Direct messages">
    <header class="dm-sidebar__header">
        <div>
            <span>Messages</span>
            <strong>Direct messages</strong>
        </div>
        <MessageCircle size={19} />
    </header>

    <div class="dm-sidebar__search">
        <Search size={15} />
        <input
            type="text"
            placeholder="Find a person"
            bind:value={query}
            oninput={onInput}
            aria-label="Find a person by username"
        />
        {#if query}
            <button
                type="button"
                onclick={clearSearch}
                title="Clear search"
                aria-label="Clear search"
            >
                <X size={14} />
            </button>
        {/if}
    </div>

    {#if query.trim()}
        <div class="dm-sidebar__section-label">Search results</div>
        <div class="dm-sidebar__results">
            {#if searching}
                <p>Searching...</p>
            {:else if results.length === 0}
                <p>No exact match found</p>
            {:else}
                {#each results as result (result.userID)}
                    <button type="button" onclick={() => openDM(result)}>
                        <Avatar
                            userID={result.userID}
                            name={result.username}
                            size={30}
                            {serverUrl}
                        />
                        <span>{result.username}</span>
                    </button>
                {/each}
            {/if}
        </div>
    {/if}

    <div class="dm-sidebar__section-label">Recent</div>
    <div class="dm-sidebar__list">
        {#each familiarList as familiar (familiar.userID)}
            <button
                class:dm-sidebar__item--active={isActive(familiar.userID)}
                class="dm-sidebar__item"
                type="button"
                onclick={() => openDM(familiar)}
            >
                <Avatar
                    userID={familiar.userID}
                    name={familiar.username}
                    size={32}
                    {serverUrl}
                />
                <span>{familiar.username}</span>
                {#if $unreadCounts[familiar.userID]}
                    <strong>
                        {$unreadCounts[familiar.userID] > 99
                            ? "99+"
                            : $unreadCounts[familiar.userID]}
                    </strong>
                {/if}
            </button>
        {/each}

        {#if familiarList.length === 0 && !query.trim()}
            <div class="dm-sidebar__empty">
                <MessageCircle size={22} />
                <strong>No conversations yet</strong>
                <span>Search above to start one.</span>
            </div>
        {/if}
    </div>
</aside>

<style>
    .dm-sidebar {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-secondary);
    }

    .dm-sidebar__header {
        height: var(--topbar-height);
        flex: 0 0 var(--topbar-height);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        border-bottom: 1px solid var(--border);
    }

    .dm-sidebar__header div {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .dm-sidebar__header span {
        color: var(--text-faint);
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .dm-sidebar__header strong {
        overflow: hidden;
        font-family: var(--font-heading);
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dm-sidebar__header :global(svg) {
        color: var(--text-faint);
    }

    .dm-sidebar__search {
        height: 46px;
        flex: 0 0 46px;
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 8px 9px 2px;
        padding: 0 9px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        color: var(--text-faint);
    }

    .dm-sidebar__search:focus-within {
        border-color: var(--border-strong);
    }

    .dm-sidebar__search input {
        min-width: 0;
        height: 100%;
        flex: 1;
        border: 0;
        background: transparent;
        box-shadow: none;
        padding: 0;
        font-size: 12px;
    }

    .dm-sidebar__search button {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 4px;
        color: var(--text-faint);
    }

    .dm-sidebar__search button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .dm-sidebar__section-label {
        padding: 12px 14px 5px;
        color: var(--text-faint);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .dm-sidebar__results {
        margin: 0 8px 4px;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-tertiary);
    }

    .dm-sidebar__results button,
    .dm-sidebar__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 9px;
        border-radius: 6px;
        color: var(--text-muted);
        text-align: left;
    }

    .dm-sidebar__results button {
        min-height: 40px;
        padding: 4px 7px;
    }

    .dm-sidebar__results button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .dm-sidebar__results p {
        padding: 10px;
        color: var(--text-faint);
        font-size: 11px;
        text-align: center;
    }

    .dm-sidebar__list {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding: 0 8px 10px;
    }

    .dm-sidebar__item {
        height: 44px;
        padding: 0 8px;
    }

    .dm-sidebar__item:hover {
        background: var(--bg-hover);
        color: var(--text-secondary);
    }

    .dm-sidebar__item--active {
        background: var(--bg-selected);
        color: var(--text-primary);
    }

    .dm-sidebar__item > span,
    .dm-sidebar__results button > span {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dm-sidebar__item > strong {
        min-width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 0 4px;
        border-radius: 9px;
        background: var(--accent);
        color: var(--on-accent);
        font-size: 9px;
    }

    .dm-sidebar__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        padding: 30px 12px;
        color: var(--text-faint);
        text-align: center;
    }

    .dm-sidebar__empty strong {
        color: var(--text-muted);
        font-size: 12px;
    }

    .dm-sidebar__empty span {
        font-size: 11px;
    }
</style>
