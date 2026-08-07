<script lang="ts">
    import type { LinkPreviewMetadata } from "@vex-chat/store";

    import { extractLinkPreviewUrl } from "@vex-chat/store";

    import { openUrl } from "@tauri-apps/plugin-opener";

    import { loadLinkPreviewForContent } from "./linkPreview.js";

    let { content }: { content: string } = $props();
    let sentinelEl: HTMLSpanElement | null = $state(null);
    let preview: LinkPreviewMetadata | null = $state(null);
    let imageFailed = $state(false);
    let shouldLoad = $state(false);

    $effect(() => {
        const previewUrl = extractLinkPreviewUrl(content);
        shouldLoad = false;
        preview = null;
        imageFailed = false;

        if (!previewUrl) {
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            shouldLoad = true;
            return;
        }
        if (!sentinelEl) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    shouldLoad = true;
                    observer.disconnect();
                }
            },
            { rootMargin: "320px 0px" },
        );
        observer.observe(sentinelEl);

        return () => {
            observer.disconnect();
        };
    });

    $effect(() => {
        if (!shouldLoad) {
            return;
        }
        let cancelled = false;

        void loadLinkPreviewForContent(content).then((nextPreview) => {
            if (!cancelled) {
                preview = nextPreview;
            }
        });

        return () => {
            cancelled = true;
        };
    });

    function displayUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.hostname.replace(/^www\./i, "")}${parsed.pathname}`;
        } catch {
            return url;
        }
    }

    function openPreview(): void {
        if (preview) {
            openUrl(preview.url).catch(console.error);
        }
    }
</script>

{#if preview}
    <button class="link-preview" type="button" onclick={openPreview}>
        {#if preview.imageUrl && !imageFailed}
            <img
                class="link-preview__image"
                src={preview.imageUrl}
                alt=""
                onerror={() => {
                    imageFailed = true;
                }}
            />
        {/if}
        <span class="link-preview__body">
            <span class="link-preview__source">
                {#if preview.faviconUrl}
                    <img
                        class="link-preview__favicon"
                        src={preview.faviconUrl}
                        alt=""
                    />
                {/if}
                <span class="link-preview__site">
                    {preview.siteName || displayUrl(preview.url)}
                </span>
            </span>
            <span class="link-preview__title">{preview.title}</span>
            {#if preview.description}
                <span class="link-preview__description">
                    {preview.description}
                </span>
            {/if}
            <span class="link-preview__url">{displayUrl(preview.url)}</span>
        </span>
    </button>
{:else}
    <span class="link-preview-sentinel" bind:this={sentinelEl}></span>
{/if}

<style>
    .link-preview-sentinel {
        display: block;
        height: 1px;
        width: 1px;
    }

    .link-preview {
        display: block;
        width: min(420px, 100%);
        overflow: hidden;
        margin: 6px 0 2px;
        padding: 0;
        text-align: left;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        color: inherit;
        cursor: pointer;
    }

    .link-preview:hover {
        background: var(--bg-hover);
    }

    .link-preview__body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
    }

    .link-preview__description {
        display: -webkit-box;
        overflow: hidden;
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.45;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
    }

    .link-preview__favicon {
        width: 14px;
        height: 14px;
        border-radius: 2px;
    }

    .link-preview__image {
        display: block;
        width: 100%;
        height: 150px;
        object-fit: cover;
        background: var(--bg-tertiary);
    }

    .link-preview__site {
        overflow: hidden;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .link-preview__source {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 6px;
    }

    .link-preview__title {
        display: -webkit-box;
        overflow: hidden;
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 650;
        line-height: 1.35;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
    }

    .link-preview__url {
        overflow: hidden;
        color: var(--accent);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
