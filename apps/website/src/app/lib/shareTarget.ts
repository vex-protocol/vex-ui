import { openDB, type DBSchema } from "idb";

const SHARE_DATABASE = "vex-web-share-target";
const SHARE_STORE = "shares";

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
    const database = await shareDatabase();
    await database.delete(SHARE_STORE, id);
    database.close();
}

export async function loadPendingShare(
    id: string,
): Promise<PendingShare | null> {
    if (!id) return null;
    const database = await shareDatabase();
    const value: unknown = await database.get(SHARE_STORE, id);
    database.close();
    return parsePendingShare(value);
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
