<script lang="ts">
    import type {
        EncryptedFileAttachment,
        MessageEmbedMediaItem,
    } from "@vex-chat/store";

    import { onDestroy, onMount } from "svelte";

    import { formatFileSize, isImageType, vexService } from "@vex-chat/store";

    let { item }: { item: MessageEmbedMediaItem } = $props();

    let error = $state("");
    let imageUrl = $state("");
    let loading = $state(false);

    const shouldPreview = $derived(
        item.mediaType === "image" ||
            item.mediaType === "svg" ||
            isImageType(item.attachment.contentType),
    );

    onMount(() => {
        if (!shouldPreview) return;
        void loadPreview();
    });

    onDestroy(() => {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
    });

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

    async function loadPreview(): Promise<void> {
        loading = true;
        error = "";
        try {
            const blob = await downloadAttachment(item.attachment);
            if (imageUrl) URL.revokeObjectURL(imageUrl);
            imageUrl = URL.createObjectURL(blob);
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : "Could not load preview";
        } finally {
            loading = false;
        }
    }

    async function openAttachment(): Promise<void> {
        error = "";
        try {
            const blob = await downloadAttachment(item.attachment);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = item.attachment.fileName;
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
        } catch (err: unknown) {
            error = err instanceof Error ? err.message : "Could not open file";
        }
    }
</script>

<div class="embed-media">
    {#if item.title}
        <div class="embed-media__title">{item.title}</div>
    {/if}

    {#if shouldPreview}
        <button
            class="embed-media__preview"
            type="button"
            onclick={() => {
                void openAttachment();
            }}
        >
            {#if imageUrl}
                <img
                    src={imageUrl}
                    alt={item.alt ?? item.attachment.fileName}
                    class="embed-media__image"
                />
            {:else}
                <span class="embed-media__placeholder">
                    {loading ? "Loading preview..." : item.attachment.fileName}
                </span>
            {/if}
        </button>
    {:else}
        <button
            class="embed-media__file"
            type="button"
            onclick={() => {
                void openAttachment();
            }}
        >
            <span class="embed-media__file-icon">Download</span>
            <span class="embed-media__file-info">
                <span class="embed-media__file-name">
                    {item.attachment.fileName}
                </span>
                <span class="embed-media__file-size">
                    {formatFileSize(item.attachment.fileSize)}
                </span>
            </span>
        </button>
    {/if}

    {#if item.caption}
        <div class="embed-media__caption">{item.caption}</div>
    {/if}
    {#if error}
        <div class="embed-media__error">{error}</div>
    {/if}
</div>

<style>
    .embed-media {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .embed-media__title {
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
    }

    .embed-media__preview {
        overflow: hidden;
        max-width: min(420px, 100%);
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        cursor: pointer;
    }

    .embed-media__image {
        display: block;
        width: 100%;
        max-height: 260px;
        object-fit: cover;
    }

    .embed-media__placeholder {
        display: block;
        padding: 28px;
        color: var(--text-muted);
        font-size: 12px;
    }

    .embed-media__file {
        display: inline-flex;
        align-items: center;
        max-width: min(400px, 100%);
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-surface);
        color: inherit;
        cursor: pointer;
        gap: 8px;
        text-align: left;
    }

    .embed-media__file-icon {
        flex-shrink: 0;
        color: var(--text-muted);
        font-size: 18px;
    }

    .embed-media__file-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
    }

    .embed-media__file-name {
        overflow: hidden;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .embed-media__file-size,
    .embed-media__caption,
    .embed-media__error {
        color: var(--text-muted);
        font-size: 11px;
    }

    .embed-media__error {
        color: #ff7a7a;
    }
</style>
