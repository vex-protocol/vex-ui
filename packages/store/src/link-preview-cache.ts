import type {
    LinkPreviewHtmlFetcher,
    LinkPreviewMetadata,
} from "./link-preview.ts";

import {
    extractLinkPreviewUrl,
    fetchLinkPreviewMetadata,
    normalizeLinkPreviewUrl,
} from "./link-preview.ts";

export interface CachedLinkPreviewLoader {
    clear: () => void;
    flush: () => Promise<void>;
    hydrate: () => Promise<void>;
    loadForContent: (content: string) => Promise<LinkPreviewMetadata | null>;
    loadForUrl: (url: string) => Promise<LinkPreviewMetadata | null>;
}

export interface LinkPreviewCacheRecord {
    expiresAt: number;
    fetchedAt: number;
    preview: LinkPreviewMetadata | null;
    url: string;
}

export interface LinkPreviewCacheSnapshot {
    entries: LinkPreviewCacheRecord[];
    version: typeof LINK_PREVIEW_CACHE_VERSION;
}

export interface LinkPreviewCacheStorage {
    read: () => Promise<unknown>;
    write: (snapshot: LinkPreviewCacheSnapshot) => Promise<void>;
}

export interface LinkPreviewLoaderOptions {
    fetchHtml: LinkPreviewHtmlFetcher;
    maxEntries?: number;
    negativeTtlMs?: number;
    now?: () => number;
    storage?: LinkPreviewCacheStorage | undefined;
    ttlMs?: number;
    writeDebounceMs?: number;
}

const LINK_PREVIEW_CACHE_VERSION = 1;
const DEFAULT_LINK_PREVIEW_CACHE_MAX_ENTRIES = 500;
const DEFAULT_LINK_PREVIEW_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LINK_PREVIEW_WRITE_DEBOUNCE_MS = 250;

interface LinkPreviewCacheEntry {
    expiresAt: number;
    fetchedAt: number;
    preview: LinkPreviewMetadata | null;
}

export function createCachedLinkPreviewLoader(
    options: LinkPreviewLoaderOptions,
): CachedLinkPreviewLoader {
    const cache = new Map<string, LinkPreviewCacheEntry>();
    const inFlight = new Map<string, Promise<LinkPreviewMetadata | null>>();
    const maxEntries =
        options.maxEntries ?? DEFAULT_LINK_PREVIEW_CACHE_MAX_ENTRIES;
    const negativeTtlMs =
        options.negativeTtlMs ?? DEFAULT_LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS;
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? DEFAULT_LINK_PREVIEW_CACHE_TTL_MS;
    const writeDebounceMs =
        options.writeDebounceMs ?? DEFAULT_LINK_PREVIEW_WRITE_DEBOUNCE_MS;

    let hydratePromise: null | Promise<void> = null;
    let writePromise = Promise.resolve();
    let writeTimer: null | ReturnType<typeof setTimeout> = null;

    function clear(): void {
        cache.clear();
        inFlight.clear();
        scheduleWrite();
    }

    function freshEntry(url: string): LinkPreviewCacheEntry | undefined {
        const entry = cache.get(url);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt <= now()) {
            cache.delete(url);
            scheduleWrite();
            return undefined;
        }
        return entry;
    }

    async function flush(): Promise<void> {
        if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
            queueWrite();
        }
        await writePromise;
    }

    async function hydrate(): Promise<void> {
        if (!options.storage) {
            return;
        }
        hydratePromise ??= options.storage
            .read()
            .then((snapshot) => {
                for (const [url, entry] of parseCacheSnapshot(
                    snapshot,
                    now(),
                )) {
                    cache.set(url, entry);
                }
                trimCache();
            })
            .catch(() => {});
        await hydratePromise;
    }

    async function loadForContent(
        content: string,
    ): Promise<LinkPreviewMetadata | null> {
        const url = extractLinkPreviewUrl(content);
        return url ? loadForUrl(url) : null;
    }

    function loadForUrl(url: string): Promise<LinkPreviewMetadata | null> {
        const normalized = normalizeLinkPreviewUrl(url);
        if (!normalized) {
            return Promise.resolve(null);
        }

        const memoryHit = freshEntry(normalized);
        if (memoryHit) {
            return Promise.resolve(memoryHit.preview);
        }

        const pending = inFlight.get(normalized);
        if (pending) {
            return pending;
        }

        const task = loadUncached(normalized).finally(() => {
            inFlight.delete(normalized);
        });
        inFlight.set(normalized, task);
        return task;
    }

    async function loadUncached(
        normalized: string,
    ): Promise<LinkPreviewMetadata | null> {
        await hydrate();
        const hydratedHit = freshEntry(normalized);
        if (hydratedHit) {
            return hydratedHit.preview;
        }

        try {
            const preview = await fetchLinkPreviewMetadata(
                normalized,
                options.fetchHtml,
            );
            remember(normalized, preview, preview ? ttlMs : negativeTtlMs);
            return preview;
        } catch {
            remember(normalized, null, negativeTtlMs);
            return null;
        }
    }

    function queueWrite(): void {
        if (!options.storage) {
            return;
        }
        const snapshot = snapshotCache(cache, now());
        writePromise = writePromise
            .catch(() => {})
            .then(() => options.storage?.write(snapshot))
            .catch(() => {});
    }

    function remember(
        url: string,
        preview: LinkPreviewMetadata | null,
        lifetimeMs: number,
    ): void {
        const fetchedAt = now();
        cache.set(url, {
            expiresAt: fetchedAt + Math.max(0, lifetimeMs),
            fetchedAt,
            preview,
        });
        trimCache();
        scheduleWrite();
    }

    function scheduleWrite(): void {
        if (!options.storage) {
            return;
        }
        if (writeTimer) {
            clearTimeout(writeTimer);
        }
        writeTimer = setTimeout(() => {
            writeTimer = null;
            queueWrite();
        }, writeDebounceMs);
    }

    function trimCache(): void {
        const currentTime = now();
        for (const [url, entry] of cache) {
            if (entry.expiresAt <= currentTime) {
                cache.delete(url);
            }
        }

        if (cache.size <= maxEntries) {
            return;
        }

        const entries = [...cache.entries()].sort(
            (a, b) => a[1].fetchedAt - b[1].fetchedAt,
        );
        for (const [url] of entries.slice(0, cache.size - maxEntries)) {
            cache.delete(url);
        }
    }

    void hydrate();

    return {
        clear,
        flush,
        hydrate,
        loadForContent,
        loadForUrl,
    };
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function parseCachedPreview(
    value: unknown,
): LinkPreviewMetadata | null | undefined {
    if (value === null) {
        return null;
    }
    if (!isRecord(value)) {
        return undefined;
    }

    const title = stringValue(value["title"]);
    const url = normalizeLinkPreviewUrl(value["url"]);
    if (!title || !url) {
        return undefined;
    }

    const preview: LinkPreviewMetadata = { title, url };
    const description = optionalStringValue(value["description"]);
    const faviconUrl = optionalStringValue(value["faviconUrl"]);
    const imageUrl = optionalStringValue(value["imageUrl"]);
    const siteName = optionalStringValue(value["siteName"]);
    if (description) preview.description = description;
    if (faviconUrl) preview.faviconUrl = faviconUrl;
    if (imageUrl) preview.imageUrl = imageUrl;
    if (siteName) preview.siteName = siteName;
    return preview;
}

function parseCacheSnapshot(
    snapshot: unknown,
    nowMs: number,
): Array<[string, LinkPreviewCacheEntry]> {
    if (
        !isRecord(snapshot) ||
        snapshot["version"] !== LINK_PREVIEW_CACHE_VERSION
    ) {
        return [];
    }
    const entries = snapshot["entries"];
    if (!Array.isArray(entries)) {
        return [];
    }

    const parsed: Array<[string, LinkPreviewCacheEntry]> = [];
    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue;
        }
        const url = normalizeLinkPreviewUrl(entry["url"]);
        const expiresAt = finiteNumber(entry["expiresAt"]);
        const fetchedAt = finiteNumber(entry["fetchedAt"]);
        const preview = parseCachedPreview(entry["preview"]);
        if (!url || !expiresAt || !fetchedAt || preview === undefined) {
            continue;
        }
        if (expiresAt <= nowMs) {
            continue;
        }
        parsed.push([url, { expiresAt, fetchedAt, preview }]);
    }
    return parsed;
}

function snapshotCache(
    cache: Map<string, LinkPreviewCacheEntry>,
    nowMs: number,
): LinkPreviewCacheSnapshot {
    const entries: LinkPreviewCacheRecord[] = [];
    for (const [url, entry] of cache) {
        if (entry.expiresAt <= nowMs) {
            continue;
        }
        entries.push({
            expiresAt: entry.expiresAt,
            fetchedAt: entry.fetchedAt,
            preview: entry.preview,
            url,
        });
    }
    entries.sort((a, b) => b.fetchedAt - a.fetchedAt);
    return { entries, version: LINK_PREVIEW_CACHE_VERSION };
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
