import { openDB, type DBSchema } from "idb";

const SHARE_DATABASE = "vex-web-share-target";
const SHARE_STORE = "shares";
const SHARE_MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingShare {
    createdAt: number;
    files: PendingShareFile[];
    id: string;
    text: string;
    title: string;
    url: string;
}

export interface PendingShareFile {
    contentType: string;
    data: Blob;
    fileName: string;
    lastModified: number;
}

interface ShareTargetDatabase extends DBSchema {
    shares: {
        key: string;
        value: PendingShare;
    };
}

export async function deletePendingShare(id: string): Promise<void> {
    if (!id) return;
    const database = await shareDatabase();
    try {
        await database.delete(SHARE_STORE, id);
    } finally {
        database.close();
    }
}

export async function consumePendingShare(
    id: string,
): Promise<PendingShare | null> {
    if (!id) return null;
    const database = await shareDatabase();
    try {
        const transaction = database.transaction(SHARE_STORE, "readwrite");
        const value: unknown = await transaction.store.get(id);
        await transaction.store.delete(id);
        await transaction.done;
        const share = parsePendingShare(value);
        return share && isFreshShare(share.createdAt) ? share : null;
    } finally {
        database.close();
    }
}

export async function clearPendingShares(): Promise<void> {
    const database = await shareDatabase();
    try {
        await database.clear(SHARE_STORE);
    } finally {
        database.close();
    }
}

export async function prunePendingShares(now = Date.now()): Promise<void> {
    const database = await shareDatabase();
    try {
        const transaction = database.transaction(SHARE_STORE, "readwrite");
        const shares = await transaction.store.getAll();
        await Promise.all(
            shares
                .filter(({ createdAt }) => !isFreshShare(createdAt, now))
                .map(({ id }) => transaction.store.delete(id)),
        );
        await transaction.done;
    } finally {
        database.close();
    }
}

export function discardPendingShareOnPageExit(id: string): () => void {
    if (!id) return () => {};
    const discard = () => {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.controller?.postMessage({
                id,
                type: "DISCARD_SHARE",
            });
        }
        void deletePendingShare(id).catch(() => {});
    };
    window.addEventListener("pagehide", discard, { once: true });
    return () => window.removeEventListener("pagehide", discard);
}

export function pendingShareFile(file: PendingShareFile): File {
    return new File([file.data], file.fileName, {
        lastModified: file.lastModified,
        type: file.contentType,
    });
}

export function sharedText(title: string, text: string, url: string): string {
    const normalizedTitle = title.trim();
    const normalizedText = text.trim();
    const normalizedURL = url.trim();
    const parts: string[] = [];
    if (normalizedTitle && !normalizedText.includes(normalizedTitle)) {
        parts.push(normalizedTitle);
    }
    if (normalizedText) parts.push(normalizedText);
    if (
        normalizedURL &&
        !normalizedTitle.includes(normalizedURL) &&
        !normalizedText.includes(normalizedURL)
    ) {
        parts.push(normalizedURL);
    }
    return parts.join("\n\n");
}

function shareDatabase() {
    return openDB<ShareTargetDatabase>(SHARE_DATABASE, 1, {
        upgrade(database) {
            if (!database.objectStoreNames.contains(SHARE_STORE)) {
                database.createObjectStore(SHARE_STORE, { keyPath: "id" });
            }
        },
    });
}

function parsePendingShare(value: unknown): PendingShare | null {
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<PendingShare>;
    if (
        typeof candidate.id !== "string" ||
        typeof candidate.createdAt !== "number" ||
        typeof candidate.title !== "string" ||
        typeof candidate.text !== "string" ||
        typeof candidate.url !== "string" ||
        !Array.isArray(candidate.files)
    ) {
        return null;
    }
    const files = candidate.files
        .map(parsePendingShareFile)
        .filter((file): file is PendingShareFile => file !== null)
        .slice(0, 10);
    return { ...candidate, files } as PendingShare;
}

function isFreshShare(createdAt: number, now = Date.now()): boolean {
    return (
        Number.isFinite(createdAt) &&
        createdAt <= now &&
        createdAt >= now - SHARE_MAX_AGE_MS
    );
}

function parsePendingShareFile(value: unknown): PendingShareFile | null {
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<PendingShareFile>;
    if (
        !(candidate.data instanceof Blob) ||
        typeof candidate.contentType !== "string" ||
        typeof candidate.fileName !== "string" ||
        typeof candidate.lastModified !== "number"
    ) {
        return null;
    }
    return candidate as PendingShareFile;
}
