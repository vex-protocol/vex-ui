<script lang="ts">
    import type { Message } from "@vex-chat/libvex";
    import type {
        EncryptedFileAttachment,
        MessageEmbedBlock,
    } from "@vex-chat/store";

    import { onDestroy } from "svelte";

    import { isImageType, messageEmbed, vexService } from "@vex-chat/store";

    import { openUrl } from "@tauri-apps/plugin-opener";

    import MessageContent from "./MessageContent.svelte";
    import MessageEmbedMedia from "./MessageEmbedMedia.svelte";
    import { renderCodeBlock } from "./utils/messages.js";

    let { message }: { message: Message } = $props();
    const embed = $derived(messageEmbed(message));
    let iconUrl = $state("");
    let activeIconUrl = "";
    let iconLoadSerial = 0;

    $effect(() => {
        const attachment = embed?.iconAttachment;
        const serial = ++iconLoadSerial;
        setIconUrl("");
        if (!attachment || !isImageType(attachment.contentType)) return;
        void loadIconAttachment(attachment, serial);
    });

    onDestroy(() => {
        iconLoadSerial += 1;
        setIconUrl("");
    });

    function blockKey(block: MessageEmbedBlock, index: number): string {
        if ("attachment" in block) {
            return `${block.type}:${block.attachment.fileID}:${index.toString()}`;
        }
        return `${block.type}:${index.toString()}`;
    }

    function embedIcon(icon: string | undefined, kind: string): string {
        const value = icon ?? kind;
        if (value.includes("audio") || value.includes("voice")) return "Mic";
        if (value.includes("bot") || value.includes("assistant")) return "AI";
        if (value.includes("branch") || value.includes("git")) return "Git";
        if (value.includes("issue")) return "Issue";
        if (value.includes("pull")) return "PR";
        if (value.includes("release")) return "Tag";
        if (value.includes("tool")) return "Tool";
        return "Info";
    }

    function setIconUrl(nextUrl: string): void {
        if (activeIconUrl) {
            URL.revokeObjectURL(activeIconUrl);
        }
        activeIconUrl = nextUrl;
        iconUrl = nextUrl;
    }

    function handleIconImageError(failedUrl: string): void {
        if (failedUrl && failedUrl === activeIconUrl) {
            setIconUrl("");
        }
    }

    async function downloadAttachment(
        attachment: EncryptedFileAttachment,
    ): Promise<Blob> {
        const result = await vexService.downloadFileAttachment(attachment);
        if (!result.ok || !result.data) {
            throw new Error(result.error ?? "Could not download file");
        }
        const buffer = new ArrayBuffer(result.data.byteLength);
        new Uint8Array(buffer).set(result.data);
        return new Blob([buffer], { type: attachment.contentType });
    }

    async function loadIconAttachment(
        attachment: EncryptedFileAttachment,
        serial: number,
    ): Promise<void> {
        try {
            const blob = await downloadAttachment(attachment);
            const nextUrl = URL.createObjectURL(blob);
            if (serial !== iconLoadSerial) {
                URL.revokeObjectURL(nextUrl);
                return;
            }
            setIconUrl(nextUrl);
        } catch {
            if (serial === iconLoadSerial) setIconUrl("");
        }
    }
</script>

{#if embed}
    <div class={`message-embed message-embed--${embed.tone ?? "info"}`}>
        <div class="message-embed__header">
            <div class="message-embed__icon">
                {#if iconUrl}
                    <img
                        class="message-embed__icon-image"
                        src={iconUrl}
                        alt=""
                        onerror={() => {
                            handleIconImageError(iconUrl);
                        }}
                    />
                {:else}
                    {embedIcon(embed.icon, embed.kind)}
                {/if}
            </div>
            <div class="message-embed__heading">
                <div class="message-embed__title">{embed.title}</div>
                {#if embed.subtitle}
                    <div class="message-embed__subtitle">{embed.subtitle}</div>
                {/if}
            </div>
        </div>

        {#if embed.fields?.length}
            <div class="message-embed__fields">
                {#each embed.fields as field, index (`${field.label}:${index.toString()}`)}
                    <div
                        class="message-embed__field"
                        class:message-embed__field--short={field.short}
                    >
                        <div class="message-embed__field-label">
                            {field.label}
                        </div>
                        <div
                            class="message-embed__field-value"
                            class:message-embed__field-value--mono={field.mono}
                        >
                            {field.value}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if embed.blocks?.length}
            <div class="message-embed__blocks">
                {#each embed.blocks as block, index (blockKey(block, index))}
                    {#if block.type === "markdown"}
                        <div class="message-embed__markdown">
                            <MessageContent
                                content={block.source === "message"
                                    ? message.message
                                    : (block.text ?? "")}
                            />
                        </div>
                    {:else if block.type === "code"}
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -- highlight.js escapes code content -->
                        {@html renderCodeBlock(block.code, block.language)}
                    {:else if block.type === "divider"}
                        <div class="message-embed__divider"></div>
                    {:else if block.type === "file"}
                        <MessageEmbedMedia
                            item={{
                                attachment: block.attachment,
                                mediaType: "file",
                            }}
                        />
                    {:else if block.type === "media"}
                        <MessageEmbedMedia item={block} />
                    {:else if block.type === "gallery"}
                        <div class="message-embed__gallery">
                            {#each block.items as item, itemIndex (`${item.attachment.fileID}:${itemIndex.toString()}`)}
                                <MessageEmbedMedia {item} />
                            {/each}
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}

        {#if embed.actions?.length}
            <div class="message-embed__actions">
                {#each embed.actions as action, index (`${action.url}:${index.toString()}`)}
                    <button
                        class="message-embed__action"
                        type="button"
                        onclick={() => {
                            void openUrl(action.url);
                        }}
                    >
                        {action.label}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .message-embed {
        max-width: min(520px, 100%);
        margin: 4px 0;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-left: 3px solid #8ab4ff;
        border-radius: 6px;
        background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
    }

    .message-embed--danger {
        border-left-color: #ff7a7a;
    }

    .message-embed--success {
        border-left-color: #59d38c;
    }

    .message-embed--warning {
        border-left-color: #ffd166;
    }

    .message-embed__header {
        display: flex;
        align-items: center;
        gap: 9px;
    }

    .message-embed__icon {
        display: grid;
        flex: 0 0 30px;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        font-size: 15px;
    }

    .message-embed__icon-image {
        display: block;
        width: 22px;
        height: 22px;
        border-radius: 4px;
        object-fit: cover;
    }

    .message-embed__heading {
        min-width: 0;
    }

    .message-embed__title {
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
    }

    .message-embed__subtitle {
        color: var(--text-muted);
        font-size: 11px;
        line-height: 1.35;
    }

    .message-embed__fields,
    .message-embed__blocks,
    .message-embed__actions {
        margin-top: 10px;
    }

    .message-embed__fields {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }

    .message-embed__field {
        flex: 1 0 100%;
        min-width: 0;
    }

    .message-embed__field--short {
        flex-basis: 44%;
    }

    .message-embed__field-label {
        color: var(--text-muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .message-embed__field-value {
        color: var(--text-secondary);
        font-size: 12px;
    }

    .message-embed__field-value--mono {
        font-family: "SF Mono", "Fira Code", monospace;
    }

    .message-embed__blocks,
    .message-embed__gallery {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .message-embed__divider {
        height: 1px;
        background: var(--border);
    }

    .message-embed__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .message-embed__action {
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--accent);
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
    }
</style>
