<script lang="ts">
    import type {
        EncryptedFileAttachment,
        MessageMarkdownNode,
    } from "@vex-chat/store";

    import {
        formatFileSize,
        parseMessageMarkdown,
        vexService,
    } from "@vex-chat/store";

    import { renderCodeBlock, renderContent } from "./utils/messages.js";

    type MessageTextNode = Extract<MessageMarkdownNode, { type: "text" }>;

    let { content }: { content: string } = $props();
    const nodes = $derived(parseMessageMarkdown(content));
    const hasAttachments = $derived(
        nodes.some((node) => node.type === "attachment"),
    );

    let attachmentError = $state("");
    let downloadingFileID = $state<null | string>(null);

    async function downloadAttachment(
        attachment: EncryptedFileAttachment,
    ): Promise<void> {
        if (downloadingFileID) {
            return;
        }
        downloadingFileID = attachment.fileID;
        attachmentError = "";
        try {
            const result = await vexService.downloadFileAttachment(attachment);
            if (!result.ok || !result.data) {
                throw new Error(result.error ?? "Could not download file");
            }
            const buffer = new ArrayBuffer(result.data.byteLength);
            new Uint8Array(buffer).set(result.data);
            const blob = new Blob([buffer], {
                type: attachment.contentType,
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = attachment.fileName;
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
        } catch (error: unknown) {
            attachmentError =
                error instanceof Error
                    ? error.message
                    : "Could not download file";
        } finally {
            downloadingFileID = null;
        }
    }

    function nodeKey(node: MessageMarkdownNode, index: number): string {
        if (node.type === "attachment") {
            return `attachment:${node.attachment.fileID}:${index.toString()}`;
        }
        return `${node.type}:${index.toString()}`;
    }

    function textNodeSource(node: MessageTextNode): string {
        return (
            node.source ?? node.segments.map((segment) => segment.text).join("")
        );
    }
</script>

{#if !hasAttachments}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify-sanitized in renderContent() -->
    {@html renderContent(content)}
{:else}
    {#each nodes as node, index (nodeKey(node, index))}
        {#if node.type === "text"}
            <div class="message-content__text">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify-sanitized in renderContent() -->
                {@html renderContent(textNodeSource(node))}
            </div>
        {:else if node.type === "codeBlock"}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- highlight.js escapes code content -->
            {@html renderCodeBlock(node.code, node.language)}
        {:else if node.type === "attachment"}
            <button
                class="message-content__file"
                type="button"
                disabled={downloadingFileID !== null}
                onclick={() => {
                    void downloadAttachment(node.attachment);
                }}
            >
                <span class="message-content__file-icon">Download</span>
                <span class="message-content__file-info">
                    <span class="message-content__file-name">
                        {node.attachment.fileName}
                    </span>
                    <span class="message-content__file-size">
                        {formatFileSize(node.attachment.fileSize)}
                    </span>
                </span>
            </button>
        {/if}
    {/each}
    {#if attachmentError}
        <div class="message-content__error">{attachmentError}</div>
    {/if}
{/if}

<style>
    .message-content__text {
        display: contents;
    }

    .message-content__file {
        display: inline-flex;
        align-items: center;
        max-width: min(400px, 100%);
        margin: 4px 0;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        color: inherit;
        cursor: pointer;
        gap: 8px;
        text-align: left;
        transition: background 0.1s;
    }

    .message-content__file:hover:not(:disabled) {
        background: var(--bg-hover);
    }

    .message-content__file:disabled {
        cursor: default;
        opacity: 0.62;
    }

    .message-content__file-icon {
        flex-shrink: 0;
        color: var(--accent);
        font-size: 18px;
    }

    .message-content__file-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
    }

    .message-content__file-name {
        overflow: hidden;
        color: var(--accent);
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .message-content__file-size {
        color: var(--text-muted);
        font-size: 11px;
    }

    .message-content__error {
        margin-top: 4px;
        color: #ff7a7a;
        font-size: 12px;
    }
</style>
