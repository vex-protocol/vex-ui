import type { LinkPreviewCacheSnapshot } from "../link-preview-cache.ts";

import { describe, expect, test, vi } from "vitest";

import { createCachedLinkPreviewLoader } from "../link-preview-cache.ts";

describe("createCachedLinkPreviewLoader", () => {
    test("returns persisted previews without refetching", async () => {
        const snapshot: LinkPreviewCacheSnapshot = {
            entries: [
                {
                    expiresAt: 10_000,
                    fetchedAt: 500,
                    preview: {
                        siteName: "Example",
                        title: "Cached title",
                        url: "https://example.com/post",
                    },
                    url: "https://example.com/post",
                },
            ],
            version: 1,
        };
        const fetchHtml = vi.fn(async () => ({
            html: '<meta property="og:title" content="Fresh title">',
        }));
        const loader = createCachedLinkPreviewLoader({
            fetchHtml,
            now: () => 1_000,
            storage: {
                read: async () => snapshot,
                write: async () => {},
            },
            writeDebounceMs: 0,
        });

        await expect(
            loader.loadForContent("read https://example.com/post"),
        ).resolves.toEqual(snapshot.entries[0]?.preview);
        expect(fetchHtml).not.toHaveBeenCalled();
    });

    test("dedupes in-flight fetches and writes resolved previews", async () => {
        let currentSnapshot: unknown = null;
        const writes: LinkPreviewCacheSnapshot[] = [];
        const fetchHtml = vi.fn(async () => ({
            html: '<meta property="og:title" content="Fresh title">',
        }));
        const loader = createCachedLinkPreviewLoader({
            fetchHtml,
            now: () => 1_000,
            storage: {
                read: async () => currentSnapshot,
                write: async (snapshot) => {
                    currentSnapshot = snapshot;
                    writes.push(snapshot);
                },
            },
            writeDebounceMs: 0,
        });

        const [first, second] = await Promise.all([
            loader.loadForUrl("https://example.com/post#first"),
            loader.loadForUrl("https://example.com/post"),
        ]);
        await loader.flush();

        expect(first).toEqual(second);
        expect(first?.title).toBe("Fresh title");
        expect(fetchHtml).toHaveBeenCalledTimes(1);
        expect(writes.at(-1)?.entries[0]?.url).toBe("https://example.com/post");

        await expect(
            loader.loadForUrl("https://example.com/post"),
        ).resolves.toEqual(first);
        expect(fetchHtml).toHaveBeenCalledTimes(1);
    });

    test("negative-caches pages without preview metadata", async () => {
        const fetchHtml = vi.fn(async () => ({ html: "<html></html>" }));
        const loader = createCachedLinkPreviewLoader({
            fetchHtml,
            now: () => 1_000,
            writeDebounceMs: 0,
        });

        await expect(
            loader.loadForUrl("https://example.com/empty"),
        ).resolves.toBeNull();
        await expect(
            loader.loadForUrl("https://example.com/empty"),
        ).resolves.toBeNull();

        expect(fetchHtml).toHaveBeenCalledTimes(1);
    });
});
