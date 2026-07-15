<script lang="ts">
    import type { Message } from "@vex-chat/libvex";

    import { onMount, tick } from "svelte";

    import { messageEmbed, type MessageEmbed } from "@vex-chat/store";

    import Avatar from "./Avatar.svelte";
    import { getServerUrl } from "./config.js";
    import LinkPreviewCard from "./LinkPreviewCard.svelte";
    import MessageContent from "./MessageContent.svelte";
    import MessageEmbedCard from "./MessageEmbedCard.svelte";
    import { user } from "./store/index.js";
    import {
        chunkMessages,
        formatTime,
        handleLinkClick,
    } from "./utils/messages.js";

    const serverUrl = getServerUrl();

    let {
        contextKey,
        messages,
        onDeleteMessageForEveryone,
        onDeleteMessageForMe,
        onEditMessage,
        usernames,
    }: {
        contextKey?: string;
        messages: Message[];
        onDeleteMessageForEveryone?: (message: Message) => void;
        onDeleteMessageForMe?: (message: Message) => void;
        onEditMessage?: (message: Message) => void;
        usernames?: Record<string, string>;
    } = $props();
    // Fallback resolved outside the destructure — eslint --fix
    // silently strips destructure defaults on svelte files.
    const usernameMap = $derived(usernames ?? {});

    const MESSAGE_PAGE_SIZE = 250;
    let visibleLimit = $state(MESSAGE_PAGE_SIZE);
    let activeContext: string | undefined = $state(undefined);
    const visibleMessages = $derived(
        messages.length > visibleLimit
            ? messages.slice(messages.length - visibleLimit)
            : messages,
    );
    const hiddenMessageCount = $derived(
        Math.max(0, messages.length - visibleMessages.length),
    );
    const chunks = $derived(chunkMessages(visibleMessages));

    let containerEl: HTMLDivElement | null = $state(null);
    let autoScroll = true;

    $effect(() => {
        if (contextKey === activeContext) return;
        activeContext = contextKey;
        visibleLimit = MESSAGE_PAGE_SIZE;
        autoScroll = true;
        setTimeout(scrollToBottom, 0);
    });

    function scrollToBottom(): void {
        if (containerEl && autoScroll) {
            containerEl.scrollTop = containerEl.scrollHeight;
        }
    }

    function onScroll(): void {
        if (!containerEl) return;
        const distFromBottom =
            containerEl.scrollHeight -
            containerEl.scrollTop -
            containerEl.clientHeight;
        autoScroll = distFromBottom < 120;
    }

    async function loadOlderMessages(): Promise<void> {
        if (!containerEl || hiddenMessageCount === 0) return;
        const previousHeight = containerEl.scrollHeight;
        visibleLimit += MESSAGE_PAGE_SIZE;
        await tick();
        containerEl.scrollTop += containerEl.scrollHeight - previousHeight;
    }

    // Scroll to bottom whenever messages change
    $effect(() => {
        void messages.length; // reactive dependency
        // nextTick equivalent — wait for DOM to update
        setTimeout(scrollToBottom, 0);
    });

    onMount(() => {
        scrollToBottom();
    });

    function embedConsumesMessage(embed: MessageEmbed | null): boolean {
        return Boolean(
            embed?.blocks?.some(
                (block) =>
                    block.type === "markdown" && block.source === "message",
            ),
        );
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="message-box"
    bind:this={containerEl}
    onscroll={onScroll}
    onclick={handleLinkClick}
    role="log"
    aria-label="Messages"
    aria-live="polite"
>
    {#if chunks.length === 0}
        <div class="message-box__empty">No messages yet.</div>
    {/if}

    {#if hiddenMessageCount > 0}
        <button
            class="message-box__older"
            type="button"
            onclick={() => void loadOlderMessages()}
        >
            Load {Math.min(hiddenMessageCount, MESSAGE_PAGE_SIZE)} older messages
        </button>
    {/if}

    {#each chunks as chunk (chunk.messages[0]?.mailID ?? chunk.firstTime + chunk.authorID)}
        <div class="message-chunk">
            <div class="message-chunk__header">
                <Avatar userID={chunk.authorID} size={36} {serverUrl} />
                <div class="message-chunk__meta">
                    <span
                        class="message-chunk__author"
                        class:message-chunk__author--self={chunk.authorID ===
                            $user?.userID}
                    >
                        {chunk.authorID === $user?.userID
                            ? "You"
                            : (usernameMap[chunk.authorID] ??
                              chunk.authorID.slice(0, 8))}
                    </span>
                    <span class="message-chunk__time"
                        >{formatTime(chunk.firstTime)}</span
                    >
                </div>
            </div>

            {#each chunk.messages as msg (msg.mailID)}
                {@const embed = messageEmbed(msg)}
                {@const isOwn = msg.authorID === $user?.userID}
                <div class="message" class:message--own={isOwn}>
                    {#if onDeleteMessageForMe || (isOwn && (onEditMessage || onDeleteMessageForEveryone))}
                        <div class="message__actions">
                            {#if isOwn && onEditMessage}
                                <button
                                    class="message__action"
                                    type="button"
                                    onclick={() => onEditMessage?.(msg)}
                                    aria-label="Edit message"
                                    title="Edit message">Edit</button
                                >
                            {/if}
                            {#if onDeleteMessageForMe}
                                <button
                                    class="message__action message__action--danger"
                                    type="button"
                                    onclick={() => onDeleteMessageForMe?.(msg)}
                                    aria-label="Delete message for me"
                                    title="Delete message for me"
                                    >Delete for me</button
                                >
                            {/if}
                            {#if isOwn && onDeleteMessageForEveryone}
                                <button
                                    class="message__action message__action--danger"
                                    type="button"
                                    onclick={() =>
                                        onDeleteMessageForEveryone?.(msg)}
                                    aria-label="Delete message for everyone"
                                    title="Delete message for everyone"
                                    >Delete for everyone</button
                                >
                            {/if}
                        </div>
                    {/if}
                    {#if !msg.decrypted}
                        <div class="message__decrypt-failure" role="alert">
                            <span
                                class="message__decrypt-failure-icon"
                                aria-hidden="true">!</span
                            >
                            <span class="message__decrypt-failure-body">
                                <span class="message__decrypt-failure-title">
                                    Message could not be decrypted
                                </span>
                                <span class="message__decrypt-failure-text">
                                    This device received the notification, but
                                    could not open the encrypted payload.
                                </span>
                                <span class="message__decrypt-failure-meta">
                                    Mail {msg.mailID.slice(0, 8)}
                                </span>
                            </span>
                        </div>
                    {:else}
                        {#if embed}
                            <MessageEmbedCard message={msg} />
                        {/if}
                        {#if !embed || (embed.display !== "replace" && !embedConsumesMessage(embed))}
                            <MessageContent content={msg.message} />
                        {/if}
                        {#if !embed?.suppressLinkPreview}
                            <LinkPreviewCard content={msg.message} />
                        {/if}
                    {/if}
                </div>
            {/each}
        </div>
    {/each}
</div>

<style>
    .message-box {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: 12px 16px;
        gap: 2px;
    }

    .message-box__empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        font-size: 14px;
        font-style: italic;
    }

    .message-box__older {
        align-self: center;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 12px;
        margin: 2px 0 10px;
        padding: 6px 12px;
    }

    .message-box__older:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .message-chunk {
        padding: 4px 0;
    }

    .message-chunk__header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 2px;
    }

    .message-chunk__meta {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding-top: 8px;
    }

    .message-chunk__author {
        font-weight: 600;
        font-size: 14px;
        color: var(--text-primary);
    }

    .message-chunk__author--self {
        color: var(--accent);
    }

    .message-chunk__time {
        font-size: 11px;
        color: var(--text-muted);
    }

    .message {
        position: relative;
        padding-left: 46px;
        padding-right: 76px;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-secondary);
        word-break: break-word;
    }

    .message__actions {
        position: absolute;
        top: -2px;
        right: 0;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 2px;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 6px;
    }

    .message:hover .message__actions,
    .message:focus-within .message__actions {
        display: flex;
    }

    .message__action {
        border: 0;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        padding: 4px 6px;
    }

    .message__action:hover {
        color: var(--text-primary);
    }

    .message__action--danger:hover {
        color: #ff7a7a;
    }

    .message__decrypt-failure {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        max-width: 420px;
        margin: 4px 0;
        padding: 10px 12px;
        border: 1px solid rgba(255, 107, 107, 0.42);
        border-left: 3px solid #e53935;
        border-radius: 8px;
        background: rgba(229, 57, 53, 0.12);
    }

    .message__decrypt-failure-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        border-radius: 7px;
        background: rgba(229, 57, 53, 0.16);
        color: #ff9b9b;
        font-size: 14px;
        font-weight: 800;
        line-height: 1;
    }

    .message__decrypt-failure-body {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
    }

    .message__decrypt-failure-title {
        color: #ff9b9b;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
    }

    .message__decrypt-failure-text {
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.4;
    }

    .message__decrypt-failure-meta {
        margin-top: 2px;
        color: var(--text-muted);
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 11px;
        line-height: 1.3;
    }

    /* ── Markdown element styles ── */
    .message :global(p) {
        margin: 0;
    }
    .message :global(p + p) {
        margin-top: 4px;
    }

    .message :global(code) {
        background: var(--bg-surface);
        border-radius: 3px;
        padding: 1px 5px;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 13px;
        color: var(--text-primary);
    }

    .message :global(pre) {
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 10px 14px;
        overflow-x: auto;
        margin: 6px 0;
    }

    .message :global(pre code) {
        background: none;
        padding: 0;
        font-size: 13px;
    }

    .message :global(.hljs) {
        color: #c9d1d9;
    }

    .message :global(.hljs-attr),
    .message :global(.hljs-attribute) {
        color: #79c0ff;
    }

    .message :global(.hljs-built_in),
    .message :global(.hljs-type) {
        color: #ffa657;
    }

    .message :global(.hljs-comment),
    .message :global(.hljs-quote) {
        color: #8b949e;
        font-style: italic;
    }

    .message :global(.hljs-keyword),
    .message :global(.hljs-selector-tag) {
        color: #ff7b72;
    }

    .message :global(.hljs-literal),
    .message :global(.hljs-name),
    .message :global(.hljs-number) {
        color: #79c0ff;
    }

    .message :global(.hljs-regexp),
    .message :global(.hljs-string) {
        color: #a5d6ff;
    }

    .message :global(.hljs-section),
    .message :global(.hljs-title) {
        color: #d2a8ff;
    }

    .message :global(a) {
        color: var(--accent);
        text-decoration: underline;
        cursor: pointer;
    }

    .message :global(blockquote) {
        border-left: 3px solid var(--border);
        margin: 4px 0;
        padding-left: 12px;
        color: var(--text-muted);
    }

    .message :global(strong) {
        color: var(--text-primary);
        font-weight: 600;
    }
    .message :global(em) {
        font-style: italic;
    }
    .message :global(del) {
        text-decoration: line-through;
        color: var(--text-muted);
    }

    .message :global(ul),
    .message :global(ol) {
        padding-left: 20px;
        margin: 2px 0;
    }

    .message :global(h1),
    .message :global(h2),
    .message :global(h3) {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 4px 0 2px;
    }
</style>
