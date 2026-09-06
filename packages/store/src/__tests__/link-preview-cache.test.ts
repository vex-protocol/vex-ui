import type { LinkPreviewCacheSnapshot } from "../link-preview-cache.ts";

import { describe, expect, test, vi } from "vitest";

import { createCachedLinkPreviewLoader } from "../link-preview-cache.ts";

describe("createCachedLinkPreviewLoader", () => {
    test("clear prevents a pending storage read from restoring old previews", async () => {
        const stored = Promise.withResolvers<unknown>();
        const write = vi.fn(async (_snapshot: LinkPreviewCacheSnapshot) => {});
        const loader = createCachedLinkPreviewLoader({
            fetchHtml: async () => ({ html: "" }),
            now: () => 1_000,
            storage: { read: () => stored.promise, write },
        });
        loader.clear();
        stored.resolve({
            entries: [
                {
                    expiresAt: 10_000,
                    fetchedAt: 500,
                    preview: { title: "Old", url: "https://example.com/" },
                    url: "https://example.com/",
                },
            ],
            version: 1,
        });
        await loader.hydrate();
        await loader.flush();

        expect(write).toHaveBeenLastCalledWith({ entries: [], version: 1 });
    });

    test("clear discards pending fetches without disturbing newer requests", async () => {
        const oldFetch = Promise.withResolvers<{ html: string }>();
        const newFetch = Promise.withResolvers<{ html: string }>();
        const fetchHtml = vi
            .fn()
            .mockReturnValueOnce(oldFetch.promise)
            .mockReturnValueOnce(newFetch.promise);
        const write = vi.fn(async (_snapshot: LinkPreviewCacheSnapshot) => {});
        const loader = createCachedLinkPreviewLoader({
            fetchHtml,
            storage: { read: async () => null, write },
        });
        const oldRequest = loader.loadForUrl("https://example.com/");
        await vi.waitFor(() => expect(fetchHtml).toHaveBeenCalledTimes(1));
        loader.clear();
        const newRequest = loader.loadForUrl("https://example.com/");
        await vi.waitFor(() => expect(fetchHtml).toHaveBeenCalledTimes(2));
        oldFetch.resolve({ html: "<title>Old</title>" });
        await expect(oldRequest).resolves.toBeNull();
        await loader.flush();
        expect(write).toHaveBeenLastCalledWith({ entries: [], version: 1 });
        expect(loader.loadForUrl("https://example.com/")).toBe(newRequest);

        newFetch.resolve({ html: "<title>New</title>" });
        await expect(newRequest).resolves.toMatchObject({ title: "New" });
        await loader.flush();
        expect(fetchHtml).toHaveBeenCalledTimes(2);
    });

    test("drops unsafe media URLs from persisted previews", async () => {
        const loader = createCachedLinkPreviewLoader({
            fetchHtml: async () => ({ html: "" }),
            now: () => 1_000,
            storage: {
                read: async () => ({
                    entries: [
                        {
                            expiresAt: 10_000,
                            fetchedAt: 500,
                            preview: {
                                faviconUrl: "file:///etc/passwd",
                                imageUrl: "http://127.0.0.1/private",
                                title: "Cached",
                                url: "https://example.com/",
                            },
                            url: "https://example.com/",
                        },
                    ],
                    version: 1,
                }),
                write: async () => {},
            },
        });
        await expect(
            loader.loadForUrl("https://example.com/"),
        ).resolves.toEqual({
            title: "Cached",
            url: "https://example.com/",
        });
    });
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
