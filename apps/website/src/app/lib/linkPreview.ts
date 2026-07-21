import type {
    LinkPreviewCacheSnapshot,
    LinkPreviewMetadata,
} from "@vex-chat/store";

import { createCachedLinkPreviewLoader } from "@vex-chat/store";

const LINK_PREVIEW_CACHE_KEY = "vex-web-link-preview-cache-v1";

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

async function fetchHtml(
    url: string,
): Promise<{ finalUrl?: string; html: string }> {
    const response = await fetch(
        `/api/link-preview?url=${encodeURIComponent(url)}`,
        {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        },
    );
    if (!response.ok) {
        throw new Error("Link preview unavailable");
    }
    const payload: unknown = await response.json();
    if (!isPreviewHtmlPayload(payload)) {
        throw new Error("Invalid link preview response");
    }
    return payload;
}

function isPreviewHtmlPayload(
    value: unknown,
): value is { finalUrl: string; html: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { finalUrl?: unknown }).finalUrl === "string" &&
        typeof (value as { html?: unknown }).html === "string"
    );
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
    try {
        localStorage.setItem(LINK_PREVIEW_CACHE_KEY, JSON.stringify(snapshot));
    } catch {
        // Preview caching is an optimization and can fail in private mode.
    }
    return Promise.resolve();
}
