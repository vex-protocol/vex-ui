import type {
    LinkPreviewCacheSnapshot,
    LinkPreviewMetadata,
} from "@vex-chat/store";

import { createCachedLinkPreviewLoader } from "@vex-chat/store";

import { invoke } from "@tauri-apps/api/core";

interface NativeLinkPreviewHtml {
    finalUrl?: string;
    html: string;
}

const LINK_PREVIEW_CACHE_KEY = "vex-link-preview-cache-v1";

const linkPreviewLoader = createCachedLinkPreviewLoader({
    fetchHtml,
    storage: {
        read: readLinkPreviewCache,
        write: writeLinkPreviewCache,
    },
});

export function loadLinkPreviewForContent(
    content: string,
): Promise<LinkPreviewMetadata | null> {
    return linkPreviewLoader.loadForContent(content);
}

void linkPreviewLoader.hydrate();

async function fetchHtml(url: string): Promise<NativeLinkPreviewHtml> {
    return invoke<NativeLinkPreviewHtml>("fetch_link_preview_html", { url });
}

function readLinkPreviewCache(): Promise<unknown> {
    try {
        const raw = localStorage.getItem(LINK_PREVIEW_CACHE_KEY);
        return Promise.resolve(raw ? (JSON.parse(raw) as unknown) : null);
    } catch {
        return Promise.resolve(null);
    }
}

function writeLinkPreviewCache(
    snapshot: LinkPreviewCacheSnapshot,
): Promise<void> {
    localStorage.setItem(LINK_PREVIEW_CACHE_KEY, JSON.stringify(snapshot));
    return Promise.resolve();
}
