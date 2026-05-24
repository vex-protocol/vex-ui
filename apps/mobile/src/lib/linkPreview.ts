import type {
    LinkPreviewCacheSnapshot,
    LinkPreviewMetadata,
} from "@vex-chat/store";

import {
    createCachedLinkPreviewLoader,
    normalizeLinkPreviewUrl,
} from "@vex-chat/store";

import * as FileSystem from "expo-file-system/legacy";

const LINK_PREVIEW_HTML_LIMIT = 512 * 1024;
const LINK_PREVIEW_REDIRECT_LIMIT = 4;
const LINK_PREVIEW_TIMEOUT_MS = 8_000;
const LINK_PREVIEW_CACHE_DIRECTORY =
    FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
const LINK_PREVIEW_CACHE_FILE = LINK_PREVIEW_CACHE_DIRECTORY
    ? `${LINK_PREVIEW_CACHE_DIRECTORY}vex-link-preview-cache-v1.json`
    : null;

const linkPreviewLoader = createCachedLinkPreviewLoader({
    fetchHtml,
    storage: LINK_PREVIEW_CACHE_FILE
        ? {
              read: readLinkPreviewCache,
              write: writeLinkPreviewCache,
          }
        : undefined,
});

interface LimitedResponseReader {
    cancel?: () => Promise<void>;
    read: () => Promise<{ done?: boolean; value?: Uint8Array }>;
    releaseLock?: () => void;
}

interface ReadableResponseBody {
    getReader: () => LimitedResponseReader;
}

export function loadLinkPreviewForContent(
    content: string,
): Promise<LinkPreviewMetadata | null> {
    return linkPreviewLoader.loadForContent(content);
}

void linkPreviewLoader.hydrate();

async function fetchHtml(
    url: string,
): Promise<{ finalUrl?: string; html: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, LINK_PREVIEW_TIMEOUT_MS);

    try {
        const previewResponse = await fetchPreviewResponse(
            url,
            controller.signal,
        );
        if (!previewResponse) {
            return { html: "" };
        }
        const { finalUrl, response } = previewResponse;
        const contentType = (
            response.headers.get("content-type") ?? ""
        ).toLowerCase();
        if (
            !response.ok ||
            (contentType &&
                !contentType.includes("text/html") &&
                !contentType.includes("application/xhtml+xml"))
        ) {
            return { html: "" };
        }

        const html = await readLimitedResponseText(response);
        if (html === null) {
            return { html: "" };
        }

        return { finalUrl, html };
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchPreviewResponse(
    url: string,
    signal: AbortSignal,
): Promise<null | { finalUrl: string; response: Response }> {
    let currentUrl = normalizeLinkPreviewUrl(url);
    if (!currentUrl) {
        return null;
    }

    for (
        let redirects = 0;
        redirects <= LINK_PREVIEW_REDIRECT_LIMIT;
        redirects++
    ) {
        const response = await globalThis.fetch(currentUrl, {
            headers: { Accept: "text/html,application/xhtml+xml" },
            redirect: "manual",
            signal,
        });
        if (!isRedirectResponse(response)) {
            const finalUrl = normalizeLinkPreviewUrl(
                response.url || currentUrl,
            );
            return finalUrl ? { finalUrl, response } : null;
        }
        if (redirects === LINK_PREVIEW_REDIRECT_LIMIT) {
            return null;
        }

        const nextUrl = resolveRedirectUrl(
            response.headers.get("location"),
            currentUrl,
        );
        if (!nextUrl) {
            return null;
        }
        currentUrl = nextUrl;
    }

    return null;
}

function getReadableResponseBody(
    response: Response,
): null | ReadableResponseBody {
    const body = response.body as unknown;
    if (!body || typeof body !== "object") {
        return null;
    }
    const getReader = (body as Partial<ReadableResponseBody>).getReader;
    return typeof getReader === "function"
        ? { getReader: getReader.bind(body) }
        : null;
}

function isRedirectResponse(response: Response): boolean {
    return response.status >= 300 && response.status < 400;
}

function joinChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
    const output = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

async function readLimitedResponseText(
    response: Response,
): Promise<null | string> {
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
        const contentLength = Number(contentLengthHeader);
        if (contentLength > LINK_PREVIEW_HTML_LIMIT) {
            return null;
        }
        if (Number.isFinite(contentLength)) {
            return (await response.text()).slice(0, LINK_PREVIEW_HTML_LIMIT);
        }
    }

    const body = getReadableResponseBody(response);
    if (!body) {
        return (await response.text()).slice(0, LINK_PREVIEW_HTML_LIMIT);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
        while (byteLength < LINK_PREVIEW_HTML_LIMIT) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }
            const remaining = LINK_PREVIEW_HTML_LIMIT - byteLength;
            if (value.byteLength > remaining) {
                chunks.push(value.subarray(0, remaining));
                byteLength += remaining;
                await reader.cancel?.();
                break;
            }
            chunks.push(value);
            byteLength += value.byteLength;
        }
    } finally {
        reader.releaseLock?.();
    }

    return new TextDecoder().decode(joinChunks(chunks, byteLength));
}

async function readLinkPreviewCache(): Promise<unknown> {
    if (!LINK_PREVIEW_CACHE_FILE) {
        return null;
    }
    try {
        return JSON.parse(
            await FileSystem.readAsStringAsync(LINK_PREVIEW_CACHE_FILE, {
                encoding: FileSystem.EncodingType.UTF8,
            }),
        ) as unknown;
    } catch {
        return null;
    }
}

function resolveRedirectUrl(
    location: null | string,
    baseUrl: string,
): null | string {
    if (!location) {
        return null;
    }
    try {
        return normalizeLinkPreviewUrl(new URL(location, baseUrl).toString());
    } catch {
        return null;
    }
}

async function writeLinkPreviewCache(
    snapshot: LinkPreviewCacheSnapshot,
): Promise<void> {
    if (!LINK_PREVIEW_CACHE_FILE) {
        return;
    }
    await FileSystem.writeAsStringAsync(
        LINK_PREVIEW_CACHE_FILE,
        JSON.stringify(snapshot),
        { encoding: FileSystem.EncodingType.UTF8 },
    );
}
